/** Landing page for each role after signing in. */
export function homePathFor(role: string) {
  if (role === "ADMIN") return "/admin";
  if (role === "PROVIDER") return "/provider";
  return "/customer";
}
