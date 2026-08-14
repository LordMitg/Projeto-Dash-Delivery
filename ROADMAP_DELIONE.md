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
| Estoque | Parcial avançado | Central visual, KPIs, níveis, reposição, scanner, lotes, validade, perdas e inventário físico auditável | Transferências entre unidades e consumo automático por lote (FEFO) |
| Compras | Parcial avançado | Fornecedores, pedidos, aprovação, recebimento, custo médio, estoque e contas a pagar integrados | Cotações concorrentes, recebimento parcial, devolução e anexos |
| Clientes | Parcial avançado | CRM, perfil, histórico, métricas, segmentos, consentimento, pontos e cashback auditáveis | Múltiplos endereços, regras automáticas, cupons e campanhas |
| Entregas | Parcial avançado | Expedição, frota, despacho próprio/terceiro/sem cadastro, código e prova de entrega | Área móvel, GPS/mapa real, rota, ETA e comunicação com o cliente |
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

Estado: fatia principal concluída em 13/08/2026.

- [x] Normalizar o ciclo operacional usado pelo pedido.
- [x] Conectar pedido público, PDV, painel, cozinha, expedição e entrega.
- [x] Produção por item, estações, SLA, prioridade, impressão e histórico auditável.
- [x] Impedir transições inválidas nas rotas do backend.
- [ ] Agendamento, cancelamento parcial e métricas históricas por estação.

### Etapa 4 — Estoque, ficha técnica e compras

Estado: quarta fatia funcional concluída em 13/08/2026.

- [x] Fornecedores, pedidos de compra e aprovações.
- [x] Pedido de compra com vários insumos e conversão individual de unidade.
- [x] Conversão de unidade por item e atualização do custo médio.
- [x] Recebimento gerando movimento de estoque e conta a pagar na mesma transação.
- [x] Recebimentos parciais por item, saldo pendente e histórico auditável de entradas.
- [x] Compra rápida para mercado/atacado sem fornecedor ou CNPJ obrigatório.
- [x] Entrada imediata com Pix, cartão, transferência, dinheiro ou pagamento futuro.
- [x] Integração da compra rápida com estoque, caixa, contas a pagar e foto opcional do cupom.
- [x] Painel de compras com métricas, fila de aprovação e sugestão de reposição.
- [x] Lotes com validade, alertas, baixa por perda e rastreabilidade no livro de estoque.
- [x] Inventário físico com comparação sistema × contagem e ajuste auditável das divergências.
- [ ] Consumo automático por lote (FEFO), transferências e cotações entre fornecedores.
- [ ] Unificar a confirmação de XML fiscal ao mesmo motor de recebimento.

### Etapa 5 — Clientes, fidelidade e marketing

Estado: segunda fatia funcional concluída em 13/08/2026.

- [x] Tela de CRM com pesquisa, indicadores e ficha completa do cliente.
- [x] Histórico de pedidos, gasto acumulado, ticket médio e última compra.
- [x] Segmentos automáticos: campeões, fiéis, novos, em risco e inativos.
- [x] Pontos e cashback com saldo e extrato auditável de ajustes.
- [x] Consentimento explícito para comunicações promocionais.
- [x] Cupons com percentual/valor fixo, vigência, pedido mínimo e limites de uso.
- [x] Mesmo cálculo seguro de cupom e cashback no PDV e cardápio digital.
- [x] Acúmulo automático de 1 ponto por real e 2% de cashback por compra.
- [x] Estorno de benefícios e liberação do cupom quando o pedido é cancelado.
- [ ] Múltiplos endereços, resgate de pontos, campanhas e regras configuráveis por loja.

### Etapa 6 — Entregas e entregadores

Estado: primeira fatia funcional concluída em 13/08/2026.

- [x] Expedição e despacho para frota própria ou entregador externo.
- [x] Permitir saída e conclusão sem entregador cadastrado.
- [x] Código de confirmação visível no acompanhamento do cliente e prova de entrega.
- [x] Disponibilidade da frota e atualização em tempo real.
- [x] Área móvel do entregador com login restrito e fila própria da loja.
- [x] QR Code seguro por pedido, leitura de várias paradas e retirada sem marketplace ou oferta de entregas.
- [x] GPS, mapa real, ordenação automática, rota sequencial, recálculo e ETA para o cliente.
- [ ] Endurecer o provedor de mapas para produção (instância dedicada/contratada, limites e monitoramento).

### Etapa 7 — Financeiro, pagamentos e fiscal

Estado: primeira fatia funcional concluída em 13/08/2026.

- [x] Central financeira com caixa, entradas, saídas, gráfico de 30 dias e resumo por forma de pagamento.
- [x] Contas a receber avulsas ou parceladas, baixa parcial/total e geração automática para vendas no fiado.
- [x] Conciliação prevista por canal, exibindo valor bruto, taxas configuradas e líquido esperado.
- [ ] Fluxo projetado reunindo contas a pagar e a receber futuras em calendário e cenários.
- [ ] Gateway abstrato, subcontas, split, webhooks idempotentes e estornos.
- [ ] Carteira, repasses e saques com trilha de auditoria.
- [ ] Emissão fiscal e obrigações, sempre isoladas por estabelecimento.

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
