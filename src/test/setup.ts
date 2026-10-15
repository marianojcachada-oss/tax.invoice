import '@testing-library/jest-dom/vitest';

// jsdom no implementa localStorage de forma completa en todos los casos,
// así que se deja un mock simple y consistente para que las pruebas de
// persistencia no dependan de detalles del entorno de testing.
class LocalStorageMock implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(window, 'localStorage', {
  value: new LocalStorageMock(),
  writable: true,
});
