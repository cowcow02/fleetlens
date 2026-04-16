export let bootstrapState: { hash: string; expiresAt: Date } | null = null;

export function setBootstrapState(state: { hash: string; expiresAt: Date }) {
  bootstrapState = state;
}

export function clearBootstrapState() {
  bootstrapState = null;
}
