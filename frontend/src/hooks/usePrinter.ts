// Tipagem da API exposta pelo preload do Electron
declare global {
  interface Window {
    printer?: {
      printKitchen: (payload: PrintKitchenPayload) => Promise<PrintResult>;
      printDelivery: (payload: PrintDeliveryPayload) => Promise<PrintResult>;
      listPorts: () => Promise<{ ports: string[] }>;
      test: (port: string) => Promise<PrintResult>;
    };
    electron?: {
      isElectron: boolean;
      platform: string;
    };
  }
}

export interface PrintResult {
  success: boolean;
  error?: string;
}

export interface PrintKitchenPayload {
  orderNumber: string;
  orderType: string;
  items: PrintItem[];
  observations?: string;
  createdAt: string;
}

export interface PrintDeliveryPayload {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  address: string;
  items: PrintItem[];
  totalAmount: number;
  paymentMethod: string;
  observations?: string;
  createdAt: string;
}

export interface PrintItem {
  productName: string;
  quantity: number;
  observations?: string;
  selectedProteinName?: string;
}

export function usePrinter() {
  const isElectron = Boolean(window.electron?.isElectron);

  async function printKitchen(payload: PrintKitchenPayload): Promise<PrintResult> {
    if (!isElectron || !window.printer) {
      console.warn('[usePrinter] Impressão apenas disponível no Electron.');
      return { success: false, error: 'Fora do ambiente Electron' };
    }
    return window.printer.printKitchen(payload);
  }

  async function printDelivery(payload: PrintDeliveryPayload): Promise<PrintResult> {
    if (!isElectron || !window.printer) {
      console.warn('[usePrinter] Impressão apenas disponível no Electron.');
      return { success: false, error: 'Fora do ambiente Electron' };
    }
    return window.printer.printDelivery(payload);
  }

  async function testPrint(port: string): Promise<PrintResult> {
    if (!isElectron || !window.printer) {
      return { success: false, error: 'Fora do ambiente Electron' };
    }
    return window.printer.test(port);
  }

  async function listPorts(): Promise<string[]> {
    if (!isElectron || !window.printer) return [];
    const result = await window.printer.listPorts();
    return result.ports;
  }

  return { printKitchen, printDelivery, testPrint, listPorts, isElectron };
}
