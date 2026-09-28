import { QRCode } from '@theme/qr-code-generator';
import { Component } from '@theme/component';
/**
 * A custom element that displays a QR code image.
 *
 * @extends {Component}
 */
class QRCodeImage extends Component {
  /** @type {number} */
  #width = 72;
  /** @type {number} */
  #height = 72;
  /** @type {string} */
  #alt = '';
  /** @type {QRCode | undefined} */
  #qrCode;

  connectedCallback() {
    super.connectedCallback();
    const widthAttribute = this.getAttribute('width') ?? '';
    this.#width = Number.isNaN(Number.parseInt(widthAttribute)) ? this.#width : Number.parseInt(widthAttribute);
    const heightAttribute = this.getAttribute('height') ?? '';
    this.#height = Number.isNaN(Number.parseInt(heightAttribute)) ? this.#height : Number.parseInt(heightAttribute);
    this.#alt = this.getAttribute('alt') ?? this.#alt;

    this.#qrCode = new QRCode(this, {
      text: this.dataset.identifier || '',
      width: this.#width,
      height: this.#height,
      alt: this.#alt,
    });
  }

  /**
   * The QRCode instance rendered into this element.
   * @returns {QRCode | undefined}
   */
  get qrCode() {
    return this.#qrCode;
  }
}

if (!customElements.get('qr-code-image')) {
  customElements.define('qr-code-image', QRCodeImage);
}
