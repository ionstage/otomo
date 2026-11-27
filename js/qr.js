// Draws QR codes with Nayuki's generator and reads them from the camera with
// jsQR. Both are in js/vendor/ (see js/vendor/README.md).

import { QrCode } from './vendor/qrcodegen.js';

// Four modules of light border, as the standard asks.
const BORDER = 4;

// Draws `text` as a QR code filling `canvas`, which keeps its CSS size.
export function drawCode(canvas, text) {
  const code = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
  const modules = code.size + BORDER * 2;
  const cssSize = canvas.clientWidth || 256;
  const scale = Math.max(1, Math.floor((cssSize * (window.devicePixelRatio || 1)) / modules));
  canvas.width = canvas.height = modules * scale;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.getModule(x, y)) {
        context.fillRect((x + BORDER) * scale, (y + BORDER) * scale, scale, scale);
      }
    }
  }
  return code;
}

let jsQRLoading = null;

// jsQR is a UMD bundle, not an ES module. A classic script sets window.jsQR.
function loadJsQR() {
  jsQRLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/jsQR.js', import.meta.url).href;
    script.onload = () => resolve(window.jsQR);
    script.onerror = () => {
      jsQRLoading = null;
      reject(new Error('Could not load the QR code reader.'));
    };
    document.head.append(script);
  });
  return jsQRLoading;
}

// Shows the back camera in `video` and resolves with the text of the first
// code read. The camera stops as soon as a code is read, or on stop().
export function scanCode(video) {
  let stopped = false;
  let stream = null;
  let frame = 0;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
  const result = (async () => {
    const jsQR = await loadJsQR();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (stopped) {
      stop();
      return null;
    }
    // iOS needs both to play the camera inline.
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    return new Promise((resolve) => {
      const look = () => {
        if (stopped) {
          resolve(null);
          return;
        }
        if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          // A smaller frame reads faster and is still sharp enough.
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
          if (found?.data) {
            stop();
            resolve(found.data);
            return;
          }
        }
        frame = requestAnimationFrame(look);
      };
      look();
    });
  })();
  result.catch(stop);
  return { result, stop };
}
