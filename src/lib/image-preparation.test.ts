import { afterEach, beforeEach, test } from "node:test";
import { strict as assert } from "node:assert";
import { prepareHealthExamFile, prepareHealthImages } from "./image-preparation";

const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const webp = new TextEncoder().encode("RIFF1234WEBPVP8 ");
let originals = { Image: globalThis.Image, FileReader: globalThis.FileReader, document: globalThis.document };
let mode: "normal" | "decode" | "canvas" | "encode" | "read" = "normal";
let sources: string[] = [];
let canvases: { width: number; height: number }[] = [];
let activeReads = 0;
let maxReads = 0;

beforeEach(() => {
  originals = { Image: globalThis.Image, FileReader: globalThis.FileReader, document: globalThis.document };
  mode = "normal";
  sources = [];
  canvases = [];
  activeReads = 0;
  maxReads = 0;
  globalThis.FileReader = class {
    result = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    async readAsDataURL(file: Blob) {
      activeReads++;
      maxReads = Math.max(maxReads, activeReads);
      if (mode === "read") {
        activeReads--;
        this.onerror?.();
        return;
      }
      this.result = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
      activeReads--;
      this.onload?.();
    }
  } as unknown as typeof FileReader;
  globalThis.Image = class {
    naturalWidth = 4000;
    naturalHeight = 3000;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      sources.push(value);
      queueMicrotask(() => mode === "decode" ? this.onerror?.() : this.onload?.());
    }
  } as unknown as typeof Image;
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0, height: 0,
        getContext: () => mode === "canvas" ? null : {
          fillStyle: "", fillRect() {}, drawImage() {},
        },
        toBlob(callback: (value: Blob | null) => void) {
          callback(mode === "encode" ? null : new Blob([jpeg], { type: "image/jpeg" }));
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  } as unknown as Document;
});

afterEach(() => {
  Object.assign(globalThis, originals);
});

test("normal path compresses to JPEG, reads a data URL and limits resolution", async () => {
  const result = await prepareHealthExamFile(new File([png], "foto.png", { type: "image/png" }));
  assert.deepEqual(result, {
    file_name: "foto.jpg", mime_type: "image/jpeg",
    file_base64: Buffer.from(jpeg).toString("base64"),
  });
  assert.ok(sources[0].startsWith("data:image/png;base64,"));
  assert.equal(canvases[0].width, 1600);
  assert.equal(canvases[0].height, 1200);
});

for (const failure of ["decode", "canvas", "encode"] as const) {
  test(`${failure} failure sends the supported original without changing its bytes`, async () => {
    mode = failure;
    for (const [bytes, mime] of [[jpeg, "image/jpeg"], [png, "image/png"], [webp, "image/webp"]] as const) {
      const result = await prepareHealthExamFile(new File([bytes], "foto", { type: mime }));
      assert.equal(result.mime_type, mime);
      assert.equal(result.file_base64, Buffer.from(bytes).toString("base64"));
    }
  });
}

test("fallback identifies real PNG bytes even when gallery labels the file JPEG", async () => {
  mode = "decode";
  const result = await prepareHealthExamFile(new File([png], "foto.jpg", { type: "image/jpeg" }));
  assert.equal(result.mime_type, "image/png");
});

test("large original cannot bypass the backend eight megabyte limit", async () => {
  mode = "canvas";
  const large = new Uint8Array(8 * 1024 * 1024 + 1);
  large.set(jpeg);
  await assert.rejects(
    prepareHealthExamFile(new File([large], "foto.jpg", { type: "image/jpeg" })),
    /excede 8 MB/,
  );
});

test("HEIC is not relabeled as JPEG when conversion fails", async () => {
  mode = "decode";
  await assert.rejects(
    prepareHealthExamFile(new File(["unsupported"], "foto.heic", { type: "image/heic" })),
    /converter este formato/,
  );
});

test("file access failures have their own message and do not pretend analysis was attempted", async () => {
  mode = "read";
  const file = new File([jpeg], "foto.jpg", { type: "image/jpeg" });
  file.arrayBuffer = async () => { throw new Error("NotReadableError"); };
  await assert.rejects(
    prepareHealthExamFile(file),
    /acessar o arquivo/,
  );
  assert.equal(sources.length, 0);
});

test("Android FileReader access failure falls back to original Blob bytes", async () => {
  mode = "read";
  const result = await prepareHealthExamFile(new File([jpeg], "foto.jpg", { type: "image/jpeg" }));
  assert.equal(result.mime_type, "image/jpeg");
  assert.ok(result.file_base64.length > 0);
});

test("PDF passes through without image decoding", async () => {
  const result = await prepareHealthExamFile(new File(["%PDF-1.4"], "exame.pdf", { type: "application/pdf" }));
  assert.equal(result.mime_type, "application/pdf");
  assert.equal(sources.length, 0);
});

test("multiple images prepare in order without competing gallery reads", async () => {
  mode = "decode";
  const result = await prepareHealthImages([
    new File([jpeg], "primeira.jpg", { type: "image/jpeg" }),
    new File([png], "segunda.png", { type: "image/png" }),
  ]);
  assert.deepEqual(result.map((image) => image.mime_type), ["image/jpeg", "image/png"]);
  assert.equal(maxReads, 1);
});
