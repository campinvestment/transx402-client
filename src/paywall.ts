import { createBrowserClient, type BrowserClient } from "./browser/browser-client.js";
import type { PaymentResult, TransX402Environment } from "./types.js";
import {
  FacilitationError,
  formatFacilitationError,
} from "./core/errors.js";

function displayErrorMessage(error: unknown): string {
  if (error instanceof FacilitationError) {
    return formatFacilitationError(error);
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface PaywallOptions {
  /** API key from TransX402 dashboard */
  apiKey: string;
  /**
   * Named environment (`local` | `camp` | `base`).
   * Mutually exclusive with `facilitatorUrl`.
   */
  environment?: TransX402Environment;
  /**
   * Advanced: custom facilitator. Mutually exclusive with `environment`.
   */
  facilitatorUrl?: string;
  /** Element selector or HTMLElement to gate */
  selector: string | HTMLElement;
  /** Price in IDR */
  price: number;
  /** Currency code (default: IDR) */
  currency?: string;
  /** Merchant wallet address to receive payment */
  merchantWallet: string;
  /** Title shown in paywall */
  title?: string;
  /** Description shown in paywall */
  description?: string;
  /** Resource identifier (e.g., article URL or ID) */
  resource?: string;
  /** Called when payment starts */
  onPaymentStart?: () => void;
  /** Called when payment succeeds */
  onPaymentSuccess?: (result: PaymentResult) => void;
  /** Called when payment fails */
  onPaymentError?: (error: Error) => void;
  /** CSS variables for theming */
  theme?: {
    primary?: string;
    background?: string;
    text?: string;
    borderRadius?: string;
  };
}

interface PaywallState {
  isOpen: boolean;
  isProcessing: boolean;
  error: string | null;
  step: "connect" | "approve" | "pay" | "success";
}

function buildClientOptions(options: PaywallOptions) {
  const base = {
    apiKey: options.apiKey,
    onPaymentStart: () => {
      /* set by Paywall */
    },
    onPaymentSuccess: (_result: PaymentResult) => {
      /* set by Paywall */
    },
    onPaymentError: (_error: Error) => {
      /* set by Paywall */
    },
    onWalletConnect: () => {
      /* set by Paywall */
    },
  };

  if (options.environment != null && options.facilitatorUrl != null) {
    throw new Error(
      "Set either `environment` or `facilitatorUrl`, not both."
    );
  }

  if (options.environment != null) {
    return { ...base, environment: options.environment } as const;
  }

  if (options.facilitatorUrl != null) {
    return { ...base, facilitatorUrl: options.facilitatorUrl } as const;
  }

  throw new Error(
    "Set `environment` (\"local\" | \"camp\" | \"base\") or `facilitatorUrl`."
  );
}

export class Paywall {
  private options: PaywallOptions;
  private client: BrowserClient;
  private targetElement: HTMLElement | null = null;
  private overlayElement: HTMLElement | null = null;
  private modalElement: HTMLElement | null = null;
  private paymentInFlight = false;
  private state: PaywallState = {
    isOpen: false,
    isProcessing: false,
    error: null,
    step: "connect",
  };

  constructor(options: PaywallOptions) {
    this.options = {
      currency: "IDR",
      title: "Premium Content",
      description: `Pay Rp ${options.price.toLocaleString("id-ID")} to unlock this content`,
      ...options,
    };

    const clientOptions = buildClientOptions(this.options);

    this.client = createBrowserClient({
      ...clientOptions,
      onPaymentStart: () => {
        this.setState({ isProcessing: true, error: null });
        this.options.onPaymentStart?.();
      },
      onPaymentSuccess: (result) => {
        this.setState({ isProcessing: false, step: "success" });
        this.unlockContent();
        this.options.onPaymentSuccess?.(result);
      },
      onPaymentError: (error) => {
        this.setState({ isProcessing: false, error: displayErrorMessage(error) });
        this.options.onPaymentError?.(error);
      },
      onWalletConnect: () => {
        this.setState({ step: "pay" });
      },
    });

    this.init();
  }

  private init() {
    if (typeof this.options.selector === "string") {
      this.targetElement = document.querySelector(this.options.selector);
    } else {
      this.targetElement = this.options.selector;
    }

    if (!this.targetElement) {
      console.error("Paywall: Target element not found");
      return;
    }

    this.lockContent();
  }

  private lockContent() {
    if (!this.targetElement) return;

    this.targetElement.style.filter = "blur(8px)";
    this.targetElement.style.pointerEvents = "none";
    this.targetElement.style.userSelect = "none";

    this.createOverlay();
  }

  private unlockContent() {
    if (!this.targetElement) return;

    this.targetElement.style.filter = "";
    this.targetElement.style.pointerEvents = "";
    this.targetElement.style.userSelect = "";

    if (this.overlayElement && this.overlayElement.parentNode) {
      this.overlayElement.parentNode.removeChild(this.overlayElement);
    }
  }

  private createOverlay() {
    if (!this.targetElement) return;

    const overlay = document.createElement("div");
    overlay.className = "transx402-paywall-overlay";
    overlay.innerHTML = `
      <div class="transx402-paywall-content">
        <div class="transx402-paywall-icon">🔒</div>
        <h3 class="transx402-paywall-title">${this.options.title}</h3>
        <p class="transx402-paywall-description">${this.options.description}</p>
        <button type="button" class="transx402-paywall-button" onclick="event.stopPropagation(); this.closest('.transx402-paywall-overlay').dispatchEvent(new CustomEvent('paywall:open'))">
          <span class="transx402-paywall-button-text">Pay with IDRX</span>
          <span class="transx402-paywall-button-price">Rp ${this.options.price.toLocaleString("id-ID")}</span>
        </button>
        <p class="transx402-paywall-footer">Powered by TransX402</p>
      </div>
    `;

    const theme = this.options.theme || {};
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(to bottom, rgba(255,255,255,0.8), rgba(255,255,255,0.95));
      z-index: 100;
      cursor: pointer;
    `;

    this.injectStyles(theme);

    const parent = this.targetElement.parentElement;
    if (parent) {
      parent.style.position = "relative";
      parent.appendChild(overlay);
    }

    this.overlayElement = overlay;

    overlay.addEventListener("click", (event) => {
      if (event.target !== overlay) return;
      this.open();
    });
    overlay.addEventListener("paywall:open", () => this.open());
  }

  private injectStyles(theme: PaywallOptions["theme"]) {
    const styleId = "transx402-paywall-styles";
    if (document.getElementById(styleId)) return;

    const primary = theme?.primary || "#2563eb";
    const background = theme?.background || "#ffffff";
    const text = theme?.text || "#0f172a";
    const borderRadius = theme?.borderRadius || "12px";

    const styles = document.createElement("style");
    styles.id = styleId;
    styles.textContent = `
      .transx402-paywall-content {
        text-align: center;
        padding: 2rem;
        background: ${background};
        border-radius: ${borderRadius};
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        max-width: 400px;
        width: 90%;
        border: 1px solid #e2e8f0;
      }
      
      .transx402-paywall-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
      }
      
      .transx402-paywall-title {
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
        color: ${text};
      }
      
      .transx402-paywall-description {
        font-size: 1rem;
        color: #64748b;
        margin: 0 0 1.5rem 0;
        line-height: 1.5;
      }
      
      .transx402-paywall-button {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 1rem;
        background: ${primary};
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 1rem;
        font-weight: 500;
        transition: all 0.2s;
        gap: 0.25rem;
      }
      
      .transx402-paywall-button:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }
      
      .transx402-paywall-button:active {
        transform: translateY(0);
      }
      
      .transx402-paywall-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .transx402-paywall-button-text {
        font-size: 1rem;
        font-weight: 600;
      }
      
      .transx402-paywall-button-price {
        font-size: 0.875rem;
        opacity: 0.9;
      }
      
      .transx402-paywall-footer {
        font-size: 0.75rem;
        color: #94a3b8;
        margin: 1rem 0 0 0;
      }

      .transx402-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 1rem;
      }

      .transx402-modal {
        background: ${background};
        border-radius: ${borderRadius};
        max-width: 450px;
        width: 100%;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      }

      .transx402-modal-header {
        padding: 1.5rem;
        border-bottom: 1px solid #e2e8f0;
      }

      .transx402-modal-title {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0;
        color: ${text};
      }

      .transx402-modal-body {
        padding: 1.5rem;
      }

      .transx402-modal-footer {
        padding: 1rem 1.5rem;
        border-top: 1px solid #e2e8f0;
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }

      .transx402-error {
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #dc2626;
        padding: 0.75rem;
        border-radius: 6px;
        font-size: 0.875rem;
        margin-bottom: 1rem;
      }

      .transx402-step-indicator {
        display: flex;
        justify-content: center;
        gap: 0.5rem;
        margin-bottom: 1.5rem;
      }

      .transx402-step {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #e2e8f0;
      }

      .transx402-step.active {
        background: ${primary};
      }

      .transx402-loader {
        display: inline-block;
        width: 20px;
        height: 20px;
        border: 2px solid rgba(255,255,255,0.3);
        border-radius: 50%;
        border-top-color: white;
        animation: transx402-spin 1s ease-in-out infinite;
      }

      @keyframes transx402-spin {
        to { transform: rotate(360deg); }
      }
    `;

    document.head.appendChild(styles);
  }

  private async open() {
    if (this.state.isOpen) return;

    const modal = this.createModal();
    document.body.appendChild(modal);
    this.setState({ isOpen: true, error: null });

    await this.startPaymentFlow();
  }

  private createModal(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "transx402-modal-overlay";
    overlay.innerHTML = `
      <div class="transx402-modal">
        <div class="transx402-modal-header">
          <h2 class="transx402-modal-title">${this.options.title}</h2>
        </div>
        <div class="transx402-modal-body">
          <div class="transx402-step-indicator">
            <div class="transx402-step ${this.state.step === "connect" ? "active" : ""}"></div>
            <div class="transx402-step ${this.state.step === "approve" ? "active" : ""}"></div>
            <div class="transx402-step ${this.state.step === "pay" ? "active" : ""}"></div>
          </div>
          <div id="transx402-modal-content">
            ${this.renderModalContent()}
          </div>
        </div>
      </div>
    `;

    overlay.addEventListener("click", (event) => this.handleModalClick(event));
    this.modalElement = overlay;
    return overlay;
  }

  private handleModalClick(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest("#transx402-connect-btn")) {
      event.preventDefault();
      void this.handleConnect();
      return;
    }

    if (target.closest("#transx402-approve-btn")) {
      event.preventDefault();
      void this.handleApprove();
      return;
    }

    if (target.closest("#transx402-pay-btn")) {
      event.preventDefault();
      void this.handlePay();
      return;
    }

    if (target.closest("#transx402-close-btn")) {
      event.preventDefault();
      this.close();
      return;
    }

    if (target.closest("#transx402-retry-btn")) {
      event.preventDefault();
      this.setState({ error: null });
      void this.startPaymentFlow();
      return;
    }

    if (target === this.modalElement) {
      this.close();
    }
  }

  private async resolveStepAfterWalletReady(): Promise<PaywallState["step"]> {
    const { approved } = await this.client.checkApproval();
    return approved ? "pay" : "approve";
  }

  private async handleConnect() {
    if (this.state.isProcessing || this.paymentInFlight) return;

    this.setState({ isProcessing: true, error: null });

    try {
      await this.client.connectWallet();
      const step = await this.resolveStepAfterWalletReady();
      this.setState({ isProcessing: false, step });
    } catch (err) {
      this.setState({
        isProcessing: false,
        error: displayErrorMessage(err) || "Failed to connect wallet",
      });
    }
  }

  private async handleApprove() {
    if (this.state.isProcessing || this.paymentInFlight) return;

    this.setState({ isProcessing: true, error: null });

    try {
      await this.client.requestApproval();
      this.setState({ isProcessing: false, step: "pay" });
    } catch (err) {
      this.setState({
        isProcessing: false,
        error: displayErrorMessage(err) || "Approval failed",
      });
    }
  }

  private async handlePay() {
    if (this.paymentInFlight || this.state.isProcessing) return;

    this.paymentInFlight = true;
    this.setState({ isProcessing: true, error: null });

    try {
      await this.client.pay({
        to: this.options.merchantWallet,
        amount: this.options.price.toString(),
        currency: this.options.currency || "IDR",
        resource: this.options.resource,
      });
    } catch (err) {
      this.setState({
        isProcessing: false,
        error: displayErrorMessage(err) || "Payment failed",
      });
    } finally {
      this.paymentInFlight = false;
    }
  }

  private renderModalContent(): string {
    if (this.state.error) {
      return `
        <div class="transx402-error">${this.state.error}</div>
        <button type="button" class="transx402-paywall-button" id="transx402-retry-btn">
          Try Again
        </button>
      `;
    }

    if (this.state.isProcessing) {
      return `
        <div style="text-align: center; padding: 2rem;">
          <div class="transx402-loader" style="margin: 0 auto 1rem;"></div>
          <p>Processing payment...</p>
        </div>
      `;
    }

    switch (this.state.step) {
      case "connect":
        return `
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">👛</div>
            <p style="margin-bottom: 1rem; color: #64748b;">
              Connect MetaMask, then accept adding sandbox IDRX when prompted.
              MetaMask needs IDRX in your token list to show the spending cap as a number.
            </p>
            <button class="transx402-paywall-button" id="transx402-connect-btn">
              Connect Wallet
            </button>
          </div>
        `;

      case "approve":
        return `
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">🔐</div>
            <p style="margin-bottom: 0.75rem; font-weight: 600;">
              One-time IDRX approval
            </p>
            <p style="margin-bottom: 1rem; color: #64748b; font-size: 0.9rem; text-align: left;">
              MetaMask will ask you to approve <strong>unlimited IDRX</strong> for the
              Permit2 contract (standard for gasless payments).
            </p>
            <p style="margin-bottom: 1.25rem; color: #64748b; font-size: 0.85rem; text-align: left;">
              On sandbox networks, MetaMask may show the Permit2 address
              (<code style="font-size: 0.8rem">0x0000…78BA3</code>) in the
              <em>Spending cap</em> row — that is a display bug. You are approving
              IDRX tokens, not sending ETH. Safe to confirm if the transaction is
              an <strong>Approve</strong> on IDRX.
            </p>
            <button class="transx402-paywall-button" id="transx402-approve-btn">
              Approve in MetaMask
            </button>
          </div>
        `;

      case "pay":
        return `
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">💎</div>
            <p style="margin-bottom: 0.5rem; font-size: 1.5rem; font-weight: 600;">
              Rp ${this.options.price.toLocaleString("id-ID")}
            </p>
            <p style="margin-bottom: 1.5rem; color: #64748b;">
              Sign the payment request to complete settlement
            </p>
            <button class="transx402-paywall-button" id="transx402-pay-btn">
              Pay Now
            </button>
          </div>
        `;

      case "success":
        return `
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">🎉</div>
            <p style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600;">
              Payment Successful!
            </p>
            <p style="margin-bottom: 1.5rem; color: #64748b;">
              Your content is now unlocked.
            </p>
            <button class="transx402-paywall-button" id="transx402-close-btn">
              Continue Reading
            </button>
          </div>
        `;

      default:
        return "";
    }
  }

  private async startPaymentFlow() {
    const address = await this.client.isWalletConnected();

    if (address) {
      const step = await this.resolveStepAfterWalletReady();
      this.setState({ step });
    }
  }

  private setState(newState: Partial<PaywallState>) {
    this.state = { ...this.state, ...newState };
    this.updateModal();
  }

  private updateModal() {
    const modal = document.querySelector(".transx402-modal-overlay");
    if (!modal) return;

    const content = modal.querySelector("#transx402-modal-content");
    if (content) {
      content.innerHTML = this.renderModalContent();
    }

    const steps = modal.querySelectorAll(".transx402-step");
    steps.forEach((step, index) => {
      const stepNames: Array<PaywallState["step"]> = ["connect", "approve", "pay"];
      const activeIndex = stepNames.indexOf(this.state.step);
      if (index <= activeIndex) {
        step.classList.add("active");
      } else {
        step.classList.remove("active");
      }
    });
  }

  private close() {
    this.setState({ isOpen: false });
    const modal = this.modalElement ?? document.querySelector(".transx402-modal-overlay");
    if (modal && modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
    this.modalElement = null;
  }

  destroy() {
    this.unlockContent();
    this.close();
  }
}

export function createPaywall(options: PaywallOptions): Paywall {
  return new Paywall(options);
}
