import { ApiError } from "@/lib/api";

export function authMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "E-mail ou senha inválidos.";
    if (error.status === 403) return "Este e-mail ainda não foi convidado.";
    if (error.status === 409) return "Este e-mail já está cadastrado.";
    return error.message;
  }
  if (error instanceof TypeError) {
    return "Não foi possível conectar agora. Confira sua conexão e tente novamente.";
  }
  return "Não foi possível concluir. Tente novamente.";
}
