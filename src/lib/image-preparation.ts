const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    async function tryAlternateReader() {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length === 0) throw new Error("empty_file");
        // Keep conversions bounded; spreading a full camera file can overflow.
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        resolve(btoa(binary));
      } catch {
        reject(new Error("Não foi possível acessar o arquivo selecionado. Selecione a foto novamente na galeria."));
      }
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.includes(",")) {
        reject(new Error("O navegador não conseguiu ler o arquivo selecionado."));
        return;
      }
      const encoded = reader.result.slice(reader.result.indexOf(",") + 1);
      if (!encoded) {
        reject(new Error("O arquivo selecionado está vazio."));
        return;
      }
      resolve(encoded);
    };
    reader.onerror = () => { void tryAlternateReader(); };
    reader.onabort = () => reject(new Error("A leitura da foto foi interrompida. Selecione-a novamente."));
    try {
      reader.readAsDataURL(file);
    } catch {
      void tryAlternateReader();
    }
  });
}

function originalImageMime(base64: string): string | undefined {
  const header = atob(base64.slice(0, 24));
  if (header.startsWith("\xff\xd8\xff")) return "image/jpeg";
  if (header.startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return "image/webp";
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return "image/gif";
  return undefined;
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("image_decode_timeout")), 15_000);
    function finish(error?: Error) {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve();
    }
    image.onload = () => finish();
    image.onerror = () => finish(new Error("image_decode_failed"));
    try {
      image.src = source;
    } catch {
      finish(new Error("image_decode_failed"));
    }
  });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("image_decode_failed");
  return image;
}

export async function prepareHealthExamFile(file: File): Promise<{
  file_name: string;
  mime_type: string;
  file_base64: string;
}> {
  if (file.type === "application/pdf") {
    return { file_name: file.name, mime_type: file.type, file_base64: await fileToBase64(file) };
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("Selecione uma imagem ou um arquivo PDF.");
  }

  // Read the selected file once while access to Android's gallery provider is
  // available. A data URL avoids decoding a second, independent blob URL.
  const original = await fileToBase64(file);
  const originalMime = originalImageMime(original);
  try {
    const image = await loadImage(`data:${originalMime ?? file.type};base64,${original}`);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas_unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("image_encode_timeout")), 15_000);
      const onBlob = (result: Blob | null) => {
        clearTimeout(timer);
        if (!result?.size) reject(new Error("image_encode_failed"));
        else resolve(result);
      };
      try {
        canvas.toBlob(onBlob, "image/jpeg", 0.78);
      } catch {
        clearTimeout(timer);
        reject(new Error("image_encode_failed"));
      }
    });
    if (blob.size > MAX_IMAGE_BYTES) throw new Error("image_too_large");
    const normalized = await fileToBase64(blob);
    if (originalImageMime(normalized) !== "image/jpeg") throw new Error("image_encode_failed");
    return {
      file_name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
      mime_type: "image/jpeg",
      file_base64: normalized,
    };
  } catch {
    // Gemini accepts these original formats. Canvas/decoder failure must not
    // masquerade as an invalid photo. Never relabel unsupported HEIC as JPEG.
    if (originalMime && file.size <= MAX_IMAGE_BYTES) {
      return { file_name: file.name, mime_type: originalMime, file_base64: original };
    }
    if (originalMime) {
      throw new Error(
        "O navegador não conseguiu reduzir esta foto, que excede 8 MB. Envie uma versão menor ou um recorte.",
      );
    }
    throw new Error(
      "O navegador não conseguiu converter este formato de imagem. Envie uma cópia em JPEG, PNG ou WebP.",
    );
  }
}

export async function prepareHealthImages(
  files: File[],
): Promise<{ file_base64: string; mime_type: string }[]> {
  const prepared = [];
  // Avoid several high-resolution decoders and canvases competing for mobile
  // memory at once. Preserve the selected order and fail the whole batch clearly.
  for (const file of files) prepared.push(await prepareHealthExamFile(file));
  return prepared;
}
