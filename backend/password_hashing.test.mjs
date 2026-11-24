import { expect, test } from "bun:test";
import { scryptSync } from "node:crypto";
import {
  SCRYPT_N,
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "./supabase_health_records.mjs";

test("novos hashes usam o scrypt mais forte e verificam corretamente", () => {
  const encoded = hashPassword("senha-segura");
  expect(encoded.startsWith(`scrypt$${SCRYPT_N}$8$1$`)).toBe(true);
  expect(verifyPassword("senha-segura", encoded)).toBe(true);
  expect(verifyPassword("senha-errada", encoded)).toBe(false);
  expect(passwordHashNeedsUpgrade(encoded)).toBe(false);
});

test("hashes antigos continuam válidos e são marcados para atualização", () => {
  const salt = Buffer.alloc(16);
  const digest = scryptSync("senha-antiga", salt, 64, { N: 2 ** 14, r: 8, p: 1 });
  const legacy = `scrypt$16384$8$1$${salt.toString("hex")}$${digest.toString("hex")}`;
  expect(verifyPassword("senha-antiga", legacy)).toBe(true);
  expect(passwordHashNeedsUpgrade(legacy)).toBe(true);
});

test("hash malformado nunca autentica", () => {
  expect(verifyPassword("qualquer", "texto-invalido")).toBe(false);
  expect(verifyPassword("qualquer", "bcrypt$1$2$3$aa$bb")).toBe(false);
});
