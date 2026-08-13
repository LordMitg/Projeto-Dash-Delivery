# Roadmap do DeliOne

Este documento compara o estado real do repositório com o escopo funcional do produto e com as telas de referência. Um módulo só é considerado concluído quando possui dados persistidos, isolamento por estabelecimento, autorização no backend, interface responsiva e validação do fluxo principal.

## Estado atual

| Área | Estado | O que existe hoje | Principal lacuna |
|---|---|---|---|
| Fundação SaaS | Parcial avançado | Conta global, memberships, isolamento por tenant, troca de negócio e permissões | Auditoria completa, 2FA, sessões/dispositivos e LGPD operacional |
| Identidade e navegação | Em evolução | Design vinho/dourado, shell responsivo e identidade DeliOne | Uniformizar telas antigas que ainda usam estilos inline |
| Visão geral | Parcial | KPIs, vendas, canais, pedidos em andamento e alertas | Filtros de período/filial e indicadores completos |
| PDV | Parcial avançado | Produtos, cliente, adicionais, entrega/retirada, desconto, pagamento dividido e caixa | Mesas/comandas, troca, recibos e histórico operacional |
| Pedidos | Parcial avançado | Kanban, eventos persistidos, filtros e atualização em tempo real | Todos os estados do escopo, agendamento e integrações externas |
| Cozinha | Parcial | KDS com etapas e tempo de preparo | Estações/setores, expedição, impressão automática e métricas |
| Cardápio | Parcial avançado | Central, categorias, cadastro/edição, fotos, ficha técnica, custos, margem e adicionais | Variações, publicação nos canais e importação em lote |
| Loja digital | Parcial avançado | Vitrine responsiva por slug, tema por loja, categorias, produtos, personalização, carrinho, checkout, cadastro global por telefone e acompanhamento seguro | Cupom, pedido no local, gateway online e confirmação do telefone por OTP |
| Estoque | Parcial avançado | Central visual, KPIs, níveis, reposição, scanner e livro auditável de entradas, saídas, vendas, cancelamentos e notas | Lotes, validade, inventário físico, transferências e integração com compras |
| Compras | Ausente | Importação de XML e contas a pagar relacionadas | Fornecedores, cotações, pedidos de compra, aprovações e reposição |
| Clientes | Backend inicial | Busca e cadastro usados pelo PDV, LTV básico | Tela de CRM, endereços, segmentos, fidelidade, cashback e campanhas |
| Entregas | Inicial | Taxas por bairro, frota e cálculo comparativo de custo | Despacho, entregadores, mapa, QR, rastreamento e prova de entrega |
| Financeiro | Parcial | Caixa, sangria, suprimento, contas a pagar, DRE e KPIs | Contas a receber, conciliação, previsão, metas, carteira e repasses |
| Pagamentos | Modelo local | Formas de pagamento e divisão no pedido | Gateway, subcontas, webhooks, split, estorno, disputa e saque |
| Fiscal | Parcial de entrada | Importação e processamento de NF-e de compra | Emissão NFC-e/NF-e, certificado, obrigações e apuração |
| Relatórios e IA | Inicial | Gráficos, KPIs e simuladores determinísticos | Relatórios por domínio, exportações e recomendações explicáveis |
| Configurações e integrações | Inicial | Dados da loja, horários, taxas e impressora | Central unificada, saúde de integrações, notificações e gateways |
| Painel master | Ausente | — | Lojistas, planos, assinaturas, taxas, repasses, suporte e auditoria |
| Offline e dispositivos | Parcial | PWA e acesso em rede local | Fila offline, sincronização, Android POS e ponte de impressão robusta |

## Ordem de execução

### Etapa 1 — Fundação visual e central de Cardápio

Estado: concluída em 11/08/2026.

- [x] Aplicar a identidade DeliOne na entrada, título e navegação.
- [x] Criar a central de Cardápio com KPIs, categorias, busca, margem, estoque e ativação.
- [x] Respeitar permissões de leitura e gestão.
- [x] Validar TypeScript, build de produção e responsividade da entrada.
- [x] Criar e editar produtos existentes com ficha técnica e prévia de CMV.
- [x] Associar categoria estruturada, adicionais e regras de escolha no mesmo fluxo.
- [x] Usar feedback acessível no novo fluxo, sem alertas nativos.
- [x] Validar no navegador criação, reabertura, precificação e adicional; remover os dados de teste ao final.
- [x] Aproximar ficha técnica e estoque das telas de referência.

### Etapa 2 — Loja digital e checkout

Estado: fatia principal concluída em 11/08/2026.

- [x] Tema, logo, banner, categorias, destaques e disponibilidade.
- [x] Produto com variações, adicionais, limites e observações.
- [x] Carrinho, entrega/retirada, taxa por bairro e total recalculado no servidor.
- [x] Cadastro simples compartilhado do consumidor por telefone, preservando LTV por loja.
- [x] Criação do pedido público e acompanhamento por token aleatório seguro.
- [x] Tela do dono para configurar cores e conteúdo, com prévia mobile.
- [x] Build de produção e fluxo real validados no navegador; dados artificiais removidos.
- [ ] Cupom, consumo no local, pagamento online e verificação do telefone por WhatsApp/SMS.

### Etapa 3 — Ciclo operacional do pedido

- Normalizar todos os estados previstos no escopo.
- Conectar pedido público, PDV, painel, cozinha, expedição e entrega.
- Estações de produção, SLA, atrasos, impressão e histórico auditável.
- Testes de transição para impedir saltos ou estados inválidos.

### Etapa 4 — Estoque, ficha técnica e compras

- Movimentações auditáveis, lotes, validade, perdas e inventário.
- Conversões de embalagem/unidade e custo médio.
- Fornecedores, cotações, pedidos de compra e aprovações.
- Importação fiscal confirmada gerando estoque, custo e financeiro numa transação.

### Etapa 5 — Clientes, fidelidade e marketing

- Perfil completo, múltiplos endereços e histórico.
- Segmentos, recorrência, ticket, favoritos e risco de abandono.
- Cupons, cashback, fidelidade e campanhas com consentimento.

### Etapa 6 — Entregas e entregadores

- Despacho para entregador fixo ou avulso.
- Área móvel do entregador, QR de coleta e mudança de status.
- Mapa, rota, ETA, rastreamento e prova de entrega.

### Etapa 7 — Financeiro, pagamentos e fiscal

- Contas a receber, conciliação e fluxo projetado.
- Gateway abstrato, subcontas, split, webhooks idempotentes e estornos.
- Carteira, repasses e saques com trilha de auditoria.
- Emissão fiscal e obrigações, sempre isoladas por estabelecimento.

### Etapa 8 — Relatórios e inteligência

- Relatórios por vendas, produto, margem, operação, cliente e entrega.
- Exportação PDF, Excel e CSV.
- Recomendações explicáveis, impacto estimado e aprovação humana.

### Etapa 9 — Configurações e integrações

- Empresa, unidades, usuários, pagamentos, impressão e notificações.
- Central de integrações com estado, credenciais protegidas e histórico.
- Observabilidade de webhooks, filas e sincronizações.

### Etapa 10 — Administração master da plataforma

- Lojistas, planos, assinaturas, limites e inadimplência.
- Taxas, GMV, repasses, saques, suporte e modo assistido auditado.
- Feature flags, manutenção, backups e comunicação global.

### Etapa 11 — Endurecimento e lançamento

- 2FA, recuperação segura, sessões, criptografia e revisão LGPD.
- Testes de isolamento multiempresa e autorização por rota.
- Contingência/offline, desempenho, acessibilidade e dispositivos.
- Observabilidade, backup restaurável, CI/CD e checklist de produção.

## Regra para as próximas entregas

Cada etapa será entregue em fatias pequenas. A cada fatia:

1. o contrato de dados e as regras são definidos;
2. backend e permissões são implementados;
3. a interface é adaptada às referências;
4. tipos, build e fluxo crítico são validados;
5. o resultado e a próxima fatia são registrados aqui.
