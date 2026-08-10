#!/usr/bin/env python3
"""
Gera os icones PNG do PWA a partir das cores da marca.

Por que um script e nao um PNG solto no repositorio: o icone deriva de duas
variaveis do tema (`--color-ink` e `--color-brand`, em `src/index.css`). Se a
marca mudar, roda-se o script de novo em vez de abrir um editor de imagem e
tentar acertar o tom no olho.

Sem dependencias de proposito: o sandbox nao tem sharp, ImageMagick nem
rsvg-convert, e instalar um rasterizador inteiro para desenhar quatro cantos e
uma linha seria peso desnecessario. O PNG e escrito na mao (zlib + CRC32) e as
bordas saem suaves por supersampling 4x.

Uso:  python3 scripts/generate-icons.py
"""

import os
import struct
import zlib

# Espelham `--color-ink` e `--color-brand` de src/index.css.
NAVY = (0x0B, 0x11, 0x20)
AMBER = (0xF9, 0x73, 0x16)

SS = 4  # supersampling: 4x4 amostras por pixel


def rounded_rect_hit(px, py, x0, y0, x1, y1, r):
    """O ponto esta dentro do retangulo de cantos arredondados?"""
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    # Dentro da faixa central (horizontal ou vertical) nao ha canto a testar.
    if x0 + r <= px <= x1 - r or y0 + r <= py <= y1 - r:
        return True
    # Perto de um canto: distancia ao centro do arco.
    cx = x0 + r if px < x0 + r else x1 - r
    cy = y0 + r if py < y0 + r else y1 - r
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def build_shapes(scale, maskable):
    """
    Devolve (fundo, marcas) em unidades normalizadas 0..1.

    `scale` encolhe as marcas para caberem na zona segura do icone maskable — o
    Android recorta o icone num circulo, e sem essa margem os cantos do desenho
    seriam cortados justamente onde esta a informacao.
    """
    # Fundo: quadrado inteiro no maskable (o recorte e do sistema), arredondado
    # no icone comum.
    bg = (0.0, 0.0, 1.0, 1.0, 0.0 if maskable else 0.22)

    c = 0.5
    half = 0.32 * scale  # meia-largura do quadro de leitura
    t = 0.055 * scale  # espessura dos tracos
    arm = 0.15 * scale  # comprimento de cada braco do canto
    r = t / 2

    left, right = c - half, c + half
    top, bottom = c - half, c + half

    marks = []
    for sx in (1, -1):  # 1 = esquerda, -1 = direita
        for sy in (1, -1):  # 1 = topo, -1 = base
            x = left if sx == 1 else right
            y = top if sy == 1 else bottom
            # Cada braco comeca na BORDA EXTERNA do canto (x -/+ t/2), nao no
            # ponto x. Parecia detalhe, mas com os bracos comecando em x as duas
            # tampas arredondadas se curvavam para longe uma da outra e deixavam
            # um entalhe no vertice do "L". Comecando na borda, os dois bracos
            # arredondam o MESMO vertice com o mesmo raio (t/2, centrado em x,y)
            # e a uniao sai com um canto redondo limpo.
            hx0, hx1 = (x - t / 2, x + arm) if sx == 1 else (x - arm, x + t / 2)
            marks.append((hx0, y - t / 2, hx1, y + t / 2, r))
            vy0, vy1 = (y - t / 2, y + arm) if sy == 1 else (y - arm, y + t / 2)
            marks.append((x - t / 2, vy0, x + t / 2, vy1, r))

    # Linha de leitura: o traco que faz o icone ser lido como "scanner" e nao
    # como "moldura" ou "qr code".
    marks.append((left + t * 0.6, c - t / 2, right - t * 0.6, c + t / 2, r))

    return bg, marks


def render(size, maskable):
    """Renderiza um icone e devolve os bytes RGBA."""
    bg, marks = build_shapes(0.78 if maskable else 1.0, maskable)
    bx0, by0, bx1, by1, br = bg

    inv = 1.0 / (SS * SS)
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            bg_hits = 0
            fg_hits = 0
            for sy in range(SS):
                v = (py + (sy + 0.5) / SS) / size
                for sx in range(SS):
                    u = (px + (sx + 0.5) / SS) / size
                    if rounded_rect_hit(u, v, bx0, by0, bx1, by1, br):
                        bg_hits += 1
                        for m in marks:
                            if rounded_rect_hit(u, v, *m):
                                fg_hits += 1
                                break
            if bg_hits == 0:
                row += b"\x00\x00\x00\x00"
                continue
            bg_cov = bg_hits * inv
            fg_cov = fg_hits * inv
            # Ambar sobre navy, na proporcao coberta pelas marcas.
            k = fg_cov / bg_cov
            rgb = tuple(
                round(NAVY[i] * (1 - k) + AMBER[i] * k) for i in range(3)
            )
            row += bytes((rgb[0], rgb[1], rgb[2], round(255 * bg_cov)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(png)
    print(f"  {path}  ({size}x{size}, {len(png) / 1024:.1f} KB)")


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
    os.makedirs(out, exist_ok=True)
    print("Gerando icones do PWA:")
    for size, maskable, name in (
        (192, False, "icon-192.png"),
        (512, False, "icon-512.png"),
        (512, True, "icon-maskable-512.png"),
    ):
        write_png(os.path.join(out, name), size, render(size, maskable))


if __name__ == "__main__":
    main()
