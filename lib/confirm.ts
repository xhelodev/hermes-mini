export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

type Listener = () => void;

/**
 * Estado global del diálogo de confirmación. Lo dibuja `ConfirmHost`; puede haber varios
 * montados (la raíz y cada `Modal` abierto) y solo el último montado lo muestra, porque iOS
 * no deja abrir un `Modal` encima de otro.
 */
let pending: ConfirmOptions | null = null;
let hosts: symbol[] = [];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeConfirm(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingConfirm() {
  return pending;
}

export function getTopConfirmHost() {
  return hosts[hosts.length - 1] ?? null;
}

export function registerConfirmHost(id: symbol) {
  hosts = [...hosts, id];
  emit();
  return () => {
    hosts = hosts.filter((host) => host !== id);
    emit();
  };
}

export function resolveConfirm(confirmed: boolean) {
  const current = pending;
  pending = null;
  emit();
  if (confirmed) current?.onConfirm();
}

/** Pide confirmación con el diálogo propio de la app (`ConfirmHost`) en todas las plataformas. */
export function confirmAction(options: ConfirmOptions) {
  pending = options;
  emit();
}
