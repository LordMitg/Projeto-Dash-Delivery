import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';

// ─── Tipos de dados da comanda ───────────────────────────────────────────────
interface OrderItem {
  productName: string;
  quantity: number;
  observations?: string;
  selectedProteinName?: string;
}

interface PrintKitchenPayload {
  orderNumber: string;
  orderType: string;
  items: OrderItem[];
  observations?: string;
  createdAt: string;
}

interface PrintDeliveryPayload {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  address: string;
  items: OrderItem[];
  totalAmount: number;
  paymentMethod: string;
  observations?: string;
  createdAt: string;
}

// ─── Constantes ESC/POS ───────────────────────────────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;

const CMD = {
  INIT:          Buffer.from([ESC, 0x40]),
  ALIGN_LEFT:    Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER:  Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_RIGHT:   Buffer.from([ESC, 0x61, 0x02]),
  BOLD_ON:       Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:      Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_ON:     Buffer.from([GS,  0x21, 0x11]),  // altura × 2, largura × 2
  DOUBLE_OFF:    Buffer.from([GS,  0x21, 0x00]),
  UNDERLINE_ON:  Buffer.from([ESC, 0x2d, 0x01]),
  UNDERLINE_OFF: Buffer.from([ESC, 0x2d, 0x00]),
  CUT_FULL:      Buffer.from([GS,  0x56, 0x00]),
  CUT_PARTIAL:   Buffer.from([GS,  0x56, 0x01]),
  FEED:          Buffer.from([0x0a]),              // line feed
  FEED3:         Buffer.from([0x0a, 0x0a, 0x0a]),
};

const WIDTH = 42; // Colunas padrão para papel 80mm

function line(char = '-'): Buffer {
  return Buffer.from(char.repeat(WIDTH) + '\n', 'utf8');
}

function txt(text: string): Buffer {
  return Buffer.from(text + '\n', 'utf8');
}

function pad(left: string, right: string, total = WIDTH): Buffer {
  const gap = total - left.length - right.length;
  return Buffer.from(left + ' '.repeat(Math.max(1, gap)) + right + '\n', 'utf8');
}

function formatPaymentMethod(method: string): string {
  const map: Record<string, string> = {
    cash: 'Dinheiro', credit: 'Cartao Credito', debit: 'Cartao Debito',
    pix: 'PIX', voucher: 'Vale', fiado: 'Fiado',
  };
  return map[method] || method;
}

function formatOrderType(type: string): string {
  const map: Record<string, string> = {
    delivery: 'DELIVERY', balcao: 'BALCAO', mesa: 'MESA',
  };
  return map[type] || type.toUpperCase();
}

// ─── Builder da comanda de COZINHA ────────────────────────────────────────────
function buildKitchenBuffer(payload: PrintKitchenPayload): Buffer {
  const now = new Date(payload.createdAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit',
  });

  const parts: Buffer[] = [
    CMD.INIT,
    CMD.ALIGN_CENTER,
    CMD.BOLD_ON,
    CMD.DOUBLE_ON,
    txt('** COZINHA **'),
    CMD.DOUBLE_OFF,
    CMD.BOLD_OFF,
    CMD.FEED,

    CMD.BOLD_ON,
    txt(`PEDIDO: #${payload.orderNumber}`),
    CMD.BOLD_OFF,
    txt(`Tipo: ${formatOrderType(payload.orderType)}`),
    txt(`Hora: ${now}`),
    line(),

    CMD.BOLD_ON,
    txt('ITENS:'),
    CMD.BOLD_OFF,
  ];

  for (const item of payload.items) {
    parts.push(CMD.BOLD_ON);
    parts.push(pad(`${item.quantity}x`, item.productName));
    parts.push(CMD.BOLD_OFF);

    if (item.selectedProteinName) {
      parts.push(txt(`   Proteina: ${item.selectedProteinName}`));
    }
    if (item.observations) {
      parts.push(txt(`   Obs: ${item.observations}`));
    }
  }

  parts.push(line());

  if (payload.observations) {
    parts.push(CMD.BOLD_ON);
    parts.push(txt('OBS GERAL:'));
    parts.push(CMD.BOLD_OFF);
    parts.push(txt(payload.observations));
    parts.push(line());
  }

  parts.push(CMD.FEED3);
  parts.push(CMD.CUT_PARTIAL);

  return Buffer.concat(parts);
}

// ─── Builder da comanda do ENTREGADOR ─────────────────────────────────────────
function buildDeliveryBuffer(payload: PrintDeliveryPayload): Buffer {
  const now = new Date(payload.createdAt).toLocaleString('pt-BR');
  const totalFmt = `R$ ${Number(payload.totalAmount).toFixed(2).replace('.', ',')}`;

  const parts: Buffer[] = [
    CMD.INIT,
    CMD.ALIGN_CENTER,
    CMD.BOLD_ON,
    CMD.DOUBLE_ON,
    txt('** ENTREGADOR **'),
    CMD.DOUBLE_OFF,
    CMD.BOLD_OFF,
    CMD.FEED,

    CMD.BOLD_ON,
    txt(`PEDIDO #${payload.orderNumber}`),
    CMD.BOLD_OFF,
    txt(now),
    line(),

    CMD.BOLD_ON,
    txt('CLIENTE:'),
    CMD.BOLD_OFF,
    txt(payload.customerName || 'Balcao'),
    txt(payload.customerPhone || ''),
    CMD.FEED,

    CMD.BOLD_ON,
    txt('ENDERECO:'),
    CMD.BOLD_OFF,
    txt(payload.address || 'Retirada no balcao'),
    line(),

    CMD.BOLD_ON,
    txt('ITENS:'),
    CMD.BOLD_OFF,
  ];

  for (const item of payload.items) {
    parts.push(pad(`${item.quantity}x`, item.productName));
    if (item.selectedProteinName) {
      parts.push(txt(`   > ${item.selectedProteinName}`));
    }
    if (item.observations) {
      parts.push(txt(`   ! ${item.observations}`));
    }
  }

  parts.push(line('='));
  parts.push(CMD.BOLD_ON);
  parts.push(CMD.DOUBLE_ON);
  parts.push(pad('TOTAL:', totalFmt));
  parts.push(CMD.DOUBLE_OFF);
  parts.push(CMD.BOLD_OFF);
  parts.push(txt(`Pagamento: ${formatPaymentMethod(payload.paymentMethod)}`));
  parts.push(line('='));

  if (payload.observations) {
    parts.push(CMD.BOLD_ON);
    parts.push(txt('OBS:'));
    parts.push(CMD.BOLD_OFF);
    parts.push(txt(payload.observations));
  }

  parts.push(CMD.FEED3);
  parts.push(CMD.CUT_FULL);

  return Buffer.concat(parts);
}

// ─── Envio para porta USB via Node.js fs ─────────────────────────────────────
// Impressoras térmicas USB aparecem como dispositivo de arquivo no OS:
//   Windows: \\.\USB001  /  Linux: /dev/usb/lp0  /  macOS: /dev/cu.usbmodem...
async function sendToPort(data: Buffer, portPath: string): Promise<void> {
  const fs = await import('fs');
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(portPath, { flags: 'w' });
    stream.write(data, (err) => {
      stream.end();
      if (err) reject(err);
      else resolve();
    });
    stream.on('error', reject);
  });
}

// ─── Handlers IPC ─────────────────────────────────────────────────────────────

// Renderer envia: ipcRenderer.invoke('print:kitchen', payload)
ipcMain.handle('print:kitchen', async (_event, payload: PrintKitchenPayload) => {
  try {
    const buffer = buildKitchenBuffer(payload);
    // Obter porta configurada (salva em localStorage do renderer ou config)
    const port = process.env.PRINTER_KITCHEN_PORT || '/dev/usb/lp0';
    await sendToPort(buffer, port);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Renderer envia: ipcRenderer.invoke('print:delivery', payload)
ipcMain.handle('print:delivery', async (_event, payload: PrintDeliveryPayload) => {
  try {
    const buffer = buildDeliveryBuffer(payload);
    const port = process.env.PRINTER_DELIVERY_PORT || '/dev/usb/lp0';
    await sendToPort(buffer, port);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Listar portas USB disponíveis (para configuração)
ipcMain.handle('printer:list-ports', async () => {
  const fs = await import('fs');
  const os = await import('os');

  if (os.platform() === 'linux') {
    try {
      const files = fs.readdirSync('/dev/usb').map((f) => `/dev/usb/${f}`);
      return { ports: files };
    } catch {
      return { ports: [] };
    }
  }
  if (os.platform() === 'win32') {
    // Retorna portas USB padrão Windows
    return { ports: ['\\\\.\\USB001', '\\\\.\\USB002', '\\\\.\\LPT1'] };
  }
  return { ports: [] };
});

// Imprimir buffer de teste
ipcMain.handle('printer:test', async (_event, port: string) => {
  try {
    const testBuffer = Buffer.concat([
      CMD.INIT,
      CMD.ALIGN_CENTER,
      CMD.BOLD_ON,
      txt('*** TESTE DE IMPRESSAO ***'),
      CMD.BOLD_OFF,
      txt('Impressora OK!'),
      CMD.FEED3,
      CMD.CUT_PARTIAL,
    ]);
    await sendToPort(testBuffer, port);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// ─── Janela principal ─────────────────────────────────────────────────────────
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
