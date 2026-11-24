import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import "../../test/setup-dom.mjs";

const { cleanup, render, screen, fireEvent } = await import("@testing-library/react");
const { ImagePreview } = await import("./ImagePreview");
afterEach(cleanup);

test("sent photo opens a large viewer, zooms, closes and resets on reopen without altering the image", () => {
  const src = "blob:https://example.test/original-photo";
  render(createElement(ImagePreview, { src, index: 1 }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ampliar imagem enviada 2" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByAltText("Imagem enviada 2 ampliada").getAttribute("src")).toBe(src);
  expect(screen.getByRole("button", { name: "Diminuir zoom" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Aumentar zoom" }));
  expect(screen.getByRole("button", { name: "Restaurar tamanho da imagem" }).textContent).toBe("150%");
  fireEvent.click(screen.getByRole("button", { name: "Restaurar tamanho da imagem" }));
  expect(screen.getByRole("button", { name: "Restaurar tamanho da imagem" }).textContent).toBe("100%");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ampliar imagem enviada 2" }));
  expect(screen.getByRole("button", { name: "Restaurar tamanho da imagem" }).textContent).toBe("100%");
});
