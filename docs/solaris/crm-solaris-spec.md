# CRM Solaris — Especificacao Tecnica por Pagina

> **Cliente:** Solaris Controle de Pragas
> **Base:** Voxium CRM (labrego-crm) — aproveitamento de estrutura, nao e SaaS
> **Data:** 02/03/2026
> **Fonte:** Kick-off 25/02/2026 — Priscila D'Almeida, Rodrigo Castro, Lucas Santos

---

## Sumario Executivo

O CRM Solaris sera uma aplicacao dedicada para a Solaris Controle de Pragas, construida sobre a
estrutura do Voxium CRM. **Nao e um SaaS multi-tenant** — e um produto exclusivo para a Solaris.

O objetivo e substituir o Trello + WhatsApp que a equipe usa hoje para gerenciar o fluxo comercial,
de agendamento e de qualidade, integrando futuramente com o ERP Infosoft (sistema legado do Ricardo).

**O que sera reaproveitado da base:**
- Estrutura de funis (kanban drag-and-drop com etapas configuraveis)
- Gestao de contatos (lista, detalhes, filtros, importacao Excel)
- Sistema de followups/anotacoes com historico
- Dashboard de analytics e produtividade
- Envio de email com editor rico e templates
- Login e autenticacao (Firebase Auth)
- Estrutura de roles (admin, vendedor, etc.)

**O que NAO faz parte deste CRM:**
- Super admin / multi-tenant / creditos
- Agente de voz (VAPI) / ligacoes automatizadas
- WhatsApp (nao ha integracao com WhatsApp neste CRM)
- Cadencia automatizada
- Automacoes de workflow
- Campanhas de email em massa
- Sistema de propostas PDF

---

## Mapeamento: Paginas do CRM Solaris

| # | Pagina | Rota | Base Voxium | Status |
|---|--------|------|-------------|--------|
| 1 | Login | `/login` | `src/app/login/page.tsx` | Pronto (rebranding) |
| 2 | Contatos (Base de Clientes) | `/contatos` | `src/app/contatos/page.tsx` | Adaptar |
| 3 | Detalhe do Contato | `/contatos/[id]` | `src/app/contatos/[id]/page.tsx` | Adaptar |
| 4 | Lista de Funis | `/funil` | `src/app/funil/page.tsx` | Pronto |
| 5 | Funil Comercial (Kanban) | `/funil/[funnelId]` | `src/app/funil/[funnelId]/page.tsx` | Adaptar |
| 6 | Funil Agendamento | `/funil/[funnelId]` | mesmo componente | Config (novo funil) |
| 7 | Funil Qualidade | `/funil/[funnelId]` | mesmo componente | Config (novo funil) |
| 8 | Funil Reativacao | `/funil/[funnelId]` | mesmo componente | Config (novo funil) |
| 9 | Vistoria de Orcamento | `/vistoria/nova` | **NOVO** | Desenvolver |
| 10 | Produtividade | `/funil/produtividade` | `src/app/funil/produtividade/page.tsx` | Pronto |
| 11 | Dashboard Comercial | `/analytics` | `src/app/analytics/page.tsx` | Adaptar |
| 12 | Projecao de Vendas | `/projecao-vendas` | `src/app/projecao-vendas/page.tsx` | Pronto |
| 13 | Conversao | `/conversao` | `src/app/conversao/page.tsx` | Pronto |
| 14 | Admin Usuarios | `/admin/usuarios` | `src/app/admin/usuarios/page.tsx` | Pronto |

**Total: 14 paginas** (vs 20 do Voxium — removidas 6 paginas que nao se aplicam)

---

## Detalhamento por Pagina

---

### 1. Login (`/login`)

**Base:** `src/app/login/page.tsx` — **PRONTO, so rebranding**

**Como ficara para Solaris:**
- Logo da Solaris Controle de Pragas
- Cores da marca Solaris (verde/azul — identidade visual do setor)
- Texto de boas-vindas customizado
- Mesma mecanica de autenticacao (Firebase Auth: email/senha + recuperacao de senha)

**Esforco:** Nenhum (trocar assets e cores)

---

### 2. Contatos — Base de Clientes (`/contatos`)

**Base:** `src/app/contatos/page.tsx` — **ADAPTAR**

**Como e hoje no Voxium:** Lista de contatos com filtros, importacao Excel, exportacao, atribuicao em massa.

**Como ficara para Solaris:**

**Dados do cliente (campos):**
- Nome (obrigatorio — presente em 100% dos cadastros)
- Telefone (obrigatorio — presente em 100%)
- Endereco (obrigatorio — presente em 100%)
- Data de criacao do cliente (para medir tempo de vida/LTV)
- Numero do contrato (campo-chave de consulta, integra com ERP Infosoft)
- Vendedor responsavel (nome do vendedor que cuida desse cliente)
- Email (quando houver)
- CPF/CNPJ (so obrigatorio na aprovacao da venda, nao no cadastro inicial)

**Campos especificos do setor:**
- `contractNumber` — Numero do contrato no ERP Infosoft
- `propertyType` — Tipo de imovel (residencial, comercial, industrial)
- `pestTypes` — Pragas tratadas (barata, formiga, roedor, cupim, etc.)
- `serviceType` — Tipo de servico (desinsetizacao, desratizacao, limpeza caixa d'agua, etc.)
- `contractStatus` — Status do contrato (ativo, inativo, pendente, renovacao)
- `contractExpiry` — Data de vencimento do contrato
- `lastServiceDate` — Data do ultimo servico realizado
- `monthlyValue` — Valor mensal/estimado do contrato

**Funcionalidades mantidas da base:**
- Importacao massiva via Excel (para upload da base do ERP)
- Exportacao Excel
- Atribuicao em massa de contatos a vendedores
- Busca por nome, telefone, CNPJ

**Funcionalidades novas/adaptadas:**
- **Busca por numero de contrato** — Campo de busca rapida pelo `contractNumber`
- **Filtro "meses desde ultimo servico"** — Para campanhas de reativacao (>3m, >6m, >1a, >2a)
- **Filtro "faixa de valor"** — Segmentar por ticket medio do cliente
- **Filtro por status do contrato** — Ativo, inativo, pendente, renovacao
- **Mover massivo para funil** — Selecionar contatos filtrados e mover em massa para uma etapa de qualquer funil (ex: funil Reativacao, etapa "Selecionados para Contato")

**Fluxo de uso descrito pela Priscila (reativacao):**
1. Gerente vai na pagina `/contatos`
2. Filtra: "meses desde ultimo servico > 6", "cidade = Atibaia", "valor > R$5.000"
3. Seleciona os contatos filtrados
4. Clica "Mover para Funil" → seleciona "Reativacao" → etapa "Selecionados para Contato"
5. Time comercial trabalha o funil de reativacao normalmente

**Esforco:** Medio — campos customizados, novos filtros, busca por contrato

---

### 3. Detalhe do Contato (`/contatos/[id]`)

**Base:** `src/app/contatos/[id]/page.tsx` — **ADAPTAR**

**Como e hoje no Voxium:** Painel com dados do cliente, followups, historico de atividades, upload de arquivos.

**Como ficara para Solaris:**

**Secao de dados do cliente:**
- Nome, telefone, email, endereco (padrao)
- **Numero do contrato** (campo destaque, clicavel para consulta no ERP futuro)
- **Vendedor responsavel** (vem do ERP ou atribuido no CRM)
- **Data de criacao** (desde quando e cliente)
- **Tipo de imovel** e **pragas tratadas**
- **Status do contrato** com badge colorido (ativo=verde, inativo=vermelho, pendente=amarelo)
- **Valor mensal/estimado** e **data de vencimento do contrato**
- **Ultimo servico realizado** com data

**Secao de historico de atividades:**
- Timeline com anotacoes e followups
- Filtros por tipo: Notas | Email | Sistema
- Registro de cada interacao
- **Nota:** Nao tera filtros de WhatsApp e Ligacao (removidos neste CRM)

**Secao de servicos/contratos (nova):**
- Lista de servicos vinculados ao cliente
- Status de cada servico (aprovado, pendente, concluido)
- Link para OS no ERP (quando API disponivel futuramente)

**Funcionalidades mantidas da base:**
- Followups com historico
- Audio player com velocidade (para gravar observacoes de campo)
- Email com RichTextEditor e templates
- Upload de arquivos e fotos

**Esforco:** Medio — secao de servicos/contratos, campos customizados, ajustar filtros de log

---

### 4. Lista de Funis (`/funil`)

**Base:** `src/app/funil/page.tsx` — **PRONTO**

**Como e hoje:** Grid de cards com todos os funis. Cada card mostra nome, quantidade de contatos, valor total, taxa de conversao. Criar/editar/excluir funis.

**Como ficara para Solaris:**
- 4 funis pre-criados: Comercial, Agendamento, Qualidade, Reativacao
- Solaris pode criar mais funis conforme necessidade
- Mesma funcionalidade atual

**Esforco:** Nenhum

---

### 5. Funil Comercial — Kanban (`/funil/[funnelId]`)

**Base:** `src/app/funil/[funnelId]/page.tsx` — **ADAPTAR**

**Contexto:** Hoje esse fluxo e feito no Trello. Tem 3 abas de entrada (Forms, comercial PF, comercial PJ), uma coluna de revisao, uma coluna por vendedora e colunas finais (aprovado, perdido). A nova tela substitui o Trello.

**Etapas do funil comercial (pre-configuradas):**

| Ordem | Etapa | Cor | Prob. | Descricao |
|-------|-------|-----|-------|-----------|
| 1 | Entrada - Operacional | Azul | 5% | Vistorias de campo (vindas da tela de vistoria) |
| 2 | Entrada - Comercial | Azul claro | 5% | Solicitacoes abertas pelo time comercial |
| 3 | Calculo de Orcamento | Amarelo | 15% | Rodrigo/equipe tecnica calculando valores no ERP |
| 4 | Revisao / Aguardando Info | Laranja | 20% | Pendencia de informacao para finalizar calculo |
| 5 | Envio ao Vendedor | Roxo | 40% | Orcamento calculado, enviado para vendedora negociar |
| 6 | Em Negociacao | Verde agua | 50% | Vendedora em contato com o cliente |
| 7 | Aprovado | Verde | 90% | Cliente aprovou, aguardando agendamento |
| 8 | Perdido | Vermelho | 0% | Nao fechou |

> **Nota sobre colunas por vendedora:** No Trello, cada vendedora tem uma coluna propria (Priscila, Gabriela, Julia, Priduc). No CRM, isso sera tratado via **filtro por responsavel** — cada card tem um `assignedTo` e a vendedora ve apenas seus cards com `viewScope = 'own'`. Nao precisamos de uma coluna por vendedora.

**Logica de direcionamento descrita pelo Rodrigo:**
- Quando o calculo e concluido, Rodrigo ve pelo nome de quem abriu o card e direciona para a vendedora correspondente
- No CRM: ao avancar da etapa "Calculo de Orcamento", o sistema usa o campo `assignedTo` (vendedor responsavel, que veio do ERP ou foi preenchido) para saber para quem vai
- Se veio do Forms de vistoria, o formulario ja pede "de qual vendedor e esse cliente"

**Funcionalidades do kanban que ja existem na base:**
- Drag-and-drop entre etapas
- Valor estimado por card (campo `dealValue`)
- Somatorio de valor por etapa (quanto R$ em cada coluna)
- Historico de movimentacao
- Painel de detalhes do card com followups, email
- Filtro por responsavel
- Busca por nome

**Funcionalidades novas a desenvolver:**
- **Botao "Etapa Concluida >"** no painel de detalhes — Avancar para proxima etapa com 1 clique
- **Botao "< Devolver"** — Retornar para etapa anterior (caso precise refazer calculo, por exemplo)
- **Routing automatico por vendedor** — Ao concluir calculo, direcionar para a proxima etapa ja com o vendedor correto atribuido
- **Busca por numero de contrato** — Adicionar ao campo de busca

**Esforco:** Baixo-medio — botoes avancar/retroceder, routing por vendedor, busca por contrato

---

### 6. Funil Agendamento (`/funil/[funnelId]`)

**Base:** Mesmo componente de funil — **CONFIG (novo funil)**

**Contexto:** Segundo quadro do Trello. Quando o comercial aprova, o card vai pro agendamento. Equipe: Franciele, Jessica, Stephanie.

**Etapas do funil de agendamento:**

| Ordem | Etapa | Descricao |
|-------|-------|-----------|
| 1 | Aprovados (Entrada) | Cards aprovados que chegam do funil comercial |
| 2 | Revisao Tecnica | Contratos mensalistas que precisam revisao da equipe de qualidade antes de atender |
| 3 | Em Agendamento | Agendadora em contato com cliente para marcar data |
| 4 | Agendado | Servico agendado, aguardando execucao |
| 5 | Em Execucao | Servico sendo realizado |
| 6 | Concluido / Arquivado | Servico entregue, card finalizado |

> **Visao individual:** Cada agendadora ve seus proprios cards (filtro por responsavel).

**Botoes de automacao no card (descritos pelo Rodrigo):**
- "Enviar para Finalizacao" — Move para Concluido/Arquivado
- "Devolver para Comercial" — Retorna ao funil comercial (ex: cliente desistiu)
- "Avancar Etapa" / "Retroceder Etapa"

**Como transita do Funil Comercial:** Quando card chega na etapa "Aprovado" no funil comercial, o usuario clica para mover ao Funil Agendamento (etapa "Aprovados"). Isso pode ser um botao ou uma acao no painel de detalhes.

**Esforco:** Config (criar funil + etapas) + Baixo (botao de transitar entre funis)

---

### 7. Funil Qualidade (`/funil/[funnelId]`)

**Base:** Mesmo componente de funil — **CONFIG (novo funil)**

**Contexto:** Terceiro quadro do Trello (atendimento de qualidade). Trata reclamacoes de clientes pos-servico. Rodrigo mencionou que aqui precisa ver historico de atendimento, tecnico, produto quimico, etc. — dados do ERP.

**Etapas do funil de qualidade:**

| Ordem | Etapa | Descricao |
|-------|-------|-----------|
| 1 | Reclamacoes Recebidas | Entrada de reclamacoes de clientes (pos-venda) |
| 2 | Em Investigacao | Equipe tecnica verificando o problema (tecnico, produto, data do servico) |
| 3 | Aguardando Retorno Cliente | Tentou contato com cliente, aguardando resposta |
| 4 | Retorno ao Cliente | Servico adicional sendo providenciado |
| 5 | Resolvido | Reclamacao tratada e cliente satisfeito |

**Informacoes relevantes no card (registradas como notas/followups):**
- Historico de atendimento (conversa copiada)
- Tecnico responsavel pelo servico original
- Produto quimico utilizado / principio ativo
- Data do servico original
- Tipo de reclamacao (reincidencia de praga, servico incompleto, dano, etc.)

> **Nota:** No primeiro momento, essas informacoes serao registradas manualmente como notas no card. Quando a API do ERP estiver disponivel futuramente, podera puxar automaticamente.

**Esforco:** Config (criar funil + etapas)

---

### 8. Funil Reativacao (`/funil/[funnelId]`)

**Base:** Mesmo componente de funil — **CONFIG (novo funil)**

**Contexto:** Funil separado para reativar clientes inativos. Os contatos sao filtrados na pagina `/contatos` e movidos em massa para ca.

**Etapas do funil de reativacao:**

| Ordem | Etapa | Descricao |
|-------|-------|-----------|
| 1 | Selecionados para Contato | Clientes filtrados e movidos em massa da base |
| 2 | Primeiro Contato | Tentativa de contato realizada |
| 3 | Em Negociacao | Cliente demonstrou interesse |
| 4 | Orcamento Enviado | Proposta enviada para reativacao |
| 5 | Reativado | Cliente reativou contrato |
| 6 | Sem Interesse | Cliente nao quis reativar |

**Fluxo de uso (descrito na reuniao):**
1. Gerente vai na pagina `/contatos`
2. Filtra: "meses desde ultimo servico > 6", "cidade = Atibaia", "valor > R$5.000"
3. Dos 10.000+ contatos, chega em ~500 que se encaixam
4. Seleciona e clica "Mover para Funil" → "Reativacao" → "Selecionados para Contato"
5. Time comercial trabalha os 500 contatos normalmente no kanban

**Esforco:** Config (criar funil) — os filtros novos ja estao descritos na pagina de Contatos

---

### 9. Vistoria de Orcamento (`/vistoria/nova`) — **PAGINA NOVA**

**Contexto:** Hoje os tecnicos no campo preenchem um Google Forms que gera cards no Trello via API. A nova tela substitui o Forms com UX otimizada para celular.

> Priscila: "Se voce faz um aplicativo, a gente ja ta pensando na adaptacao da nossa equipe a um aplicativo"
> Priscila: "O tecnico vai fazer um segundo servico, percebe que o cliente precisa limpar a caixa d'agua, abre a solicitacao, coloca la, eu faco em duas horas com dois tecnicos. Ja passa pro escritorio."

**Requisitos (da reuniao):**
- Tela simples e rapida de preencher (pessoal do operacional nao tem tempo)
- Comando de voz para descricao (ao inves de digitar, fala e transcreve)
- Anexo de fotos (tirar foto do local) e documentos
- Se cliente ja cadastrado, buscar por nome ou contrato e preencher dados automaticamente
- Se cliente novo, opcao de inserir manualmente

**Layout da pagina (mobile-first):**

```
+--------------------------------------+
|  < Vistoria de Orcamento            |
+--------------------------------------+
|                                      |
|  Cliente *                           |
|  +------------------------------+   |
|  | Buscar por nome ou contrato  |   |
|  +------------------------------+   |
|  [ ] Novo cliente (inserir manual)   |
|                                      |
|  --- Dados preenchidos do sistema ---|
|  Nome: Joao Silva                    |
|  Endereco: Rua X, 123 - Atibaia     |
|  Contrato: 976.000                   |
|                                      |
|  Vendedor responsavel *              |
|  +------------------------+         |
|  | Selecionar vendedor v  |         |
|  +------------------------+         |
|                                      |
|  Tipo de servico *                   |
|  +------------------------+         |
|  | Selecionar tipo v      |         |
|  | . Desinsetizacao       |         |
|  | . Desratizacao         |         |
|  | . Limpeza caixa d'agua |         |
|  | . Descupinizacao       |         |
|  | . Outro                |         |
|  +------------------------+         |
|                                      |
|  Descricao da vistoria *             |
|  +------------------------------+   |
|  |                              |   |
|  |  (texto ou voz)              |   |
|  |                              |   |
|  +------------------------------+   |
|  [mic] Gravar por voz               |
|                                      |
|  Estimativa                          |
|  +----------+  +--------------+     |
|  | Horas: 2 |  | Tecnicos: 2  |     |
|  +----------+  +--------------+     |
|                                      |
|  Fotos e documentos                  |
|  +------------------------------+   |
|  |  [cam] Tirar foto            |   |
|  |  [clip] Anexar arquivo       |   |
|  |                              |   |
|  |  [foto1.jpg] [foto2.jpg]     |   |
|  +------------------------------+   |
|                                      |
|  +------------------------------+   |
|  |      ENVIAR VISTORIA         |   |
|  +------------------------------+   |
|                                      |
+--------------------------------------+
```

**O que acontece ao enviar:**
- Cria um card no Funil Comercial na etapa "Entrada - Operacional" com todos os dados
- Card ja vem com etiqueta identificando que veio do formulario de vistoria
- Vendedor responsavel ja preenchido (para routing posterior)
- Fotos ficam como anexos no card

**Stack tecnica:**
- `src/app/vistoria/nova/page.tsx` — Pagina principal
- Web Speech API (`webkitSpeechRecognition`) para voz-para-texto
- `<input type="file" accept="image/*" capture="environment">` para camera
- Firebase Storage para upload de fotos
- Firestore para criar o card no funil

**Rodrigo vai mandar:** Link do Google Forms atual para usar como base dos campos/perguntas. O Forms tem perguntas condicionais por tipo de servico.

**Esforco:** Alto — pagina nova completa, Web Speech API, camera, upload

---

### 10. Produtividade (`/funil/produtividade`)

**Base:** `src/app/funil/produtividade/page.tsx` — **PRONTO**

**Como e hoje:** Dashboard de produtividade por membro da equipe: cards movimentados por vendedor (diario, semanal, mensal), tempo medio em cada etapa, taxa de conversao por vendedor, ranking de performance.

**Como ficara para Solaris:**
- Mesma tela, dados populados pelos funis da Solaris
- Vendedoras (Priscila Teodoro, Gabriela, Julia, Priduc) aparecerao com metricas individuais
- Agendadoras (Franciele, Jessica, Stephanie) tambem

**Metricas solicitadas pela Priscila:**
- Quantos cards cada vendedor movimenta por dia (ja existe)
- Velocidade de cada vendedor nas etapas (ja existe)
- Comparativo entre vendedores (ja existe)

> Priscila: "Isso e super importante ate pra gente orientar o colaborador, porque a gente nao gerencia resultado, a gente gerencia tarefa."

**Esforco:** Nenhum

---

### 11. Dashboard Comercial (`/analytics`)

**Base:** `src/app/analytics/page.tsx` — **ADAPTAR (novas visoes)**

**Visoes solicitadas na reuniao:**

| Visao | Descricao | Status |
|-------|-----------|--------|
| Valor de negocios por vendedor | Quanto R$ cada vendedora tem em pipeline | Ja existe (adaptar) |
| Valor de negocios por etapa | Quanto R$ em cada coluna do kanban | Ja existe |
| Conversao de vendas por etapa | % de cards que avancam em cada etapa | Ja existe |
| Conversao de vendas por vendedor | % de fechamento por vendedora | Ja existe (adaptar) |
| Clientes x mes da ultima compra | Histograma de inatividade | **NOVO** |
| Faixa de gasto por cliente | Distribuicao de ticket medio | **NOVO** |
| Vendas por vendedor (acumulado) | Volume de vendas fechadas no mes/semana | Ja existe (adaptar) |

> Priscila: "Trazer os dashboards de comercial que nos nao temos"
> Priscila: "Ah, recebi R$10.000 de negociacao, passei R$10.000 pro cliente, to negociando cinco, aprovei tres e perdi dois"

**Graficos novos a desenvolver:**

**Clientes x Tempo de Inatividade:**
```
+------------------------------------------+
|  Clientes por Tempo de Inatividade       |
|                                          |
|  ========  Ate 3 meses    |  2.340      |
|  ======    3-6 meses      |  1.890      |
|  ====      6-12 meses     |  1.200      |
|  ===       1-2 anos        |    890      |
|  ==        2+ anos         |    680      |
|                                          |
|  Total base: 7.000 clientes             |
+------------------------------------------+
```

**Faixa de Gasto por Cliente:**
```
+------------------------------------------+
|  Distribuicao por Ticket Medio           |
|                                          |
|  ==========  Ate R$500     |  3.100     |
|  =======     R$500-1000    |  2.200     |
|  ====        R$1000-3000   |  1.100     |
|  ==          R$3000-5000   |    400     |
|  =           R$5000+        |    200     |
+------------------------------------------+
```

Esses dois graficos sao fundamentais para a Priscila tomar decisoes de reativacao — saber onde estao os clientes de maior valor que estao ha mais tempo inativos.

**Esforco:** Medio — 2 novos graficos, adaptar visoes existentes para nomes de vendedoras Solaris

---

### 12. Projecao de Vendas (`/projecao-vendas`)

**Base:** `src/app/projecao-vendas/page.tsx` — **PRONTO**

**Como e hoje:** Projecao de pipeline baseada em probabilidade por etapa.

**Como ficara:** Identico, usando as probabilidades definidas nas etapas do funil comercial Solaris (5%, 15%, 20%, 40%, 50%, 90%).

**Esforco:** Nenhum

---

### 13. Conversao (`/conversao`)

**Base:** `src/app/conversao/page.tsx` — **PRONTO**

**Como e hoje:** Dashboard de conversao por etapa com analise de gargalos, tendencias e insights.

**Como ficara:** Identico, dados populados pelos funis Solaris.

**Esforco:** Nenhum

---

### 14. Admin Usuarios (`/admin/usuarios`)

**Base:** `src/app/admin/usuarios/page.tsx` — **PRONTO**

**Usuarios a configurar:**

| Nome | Funcao | Role | Escopo |
|------|--------|------|--------|
| Priscila D'Almeida | Diretora Comercial | admin | Tudo |
| Rodrigo Castro | Gestor Operacional/TI | admin | Tudo |
| Priscila Teodoro | Vendedora | seller | Seus cards |
| Gabriela | Vendedora | seller | Seus cards |
| Julia | Vendedora | seller | Seus cards |
| Priduc | Vendedora | seller | Seus cards |
| Franciele | Agendamento | seller | Seus cards |
| Jessica | Agendamento | seller | Seus cards |
| Stephanie | Agendamento | seller | Seus cards |
| Equipe Qualidade | Pos-venda | manager | Funil qualidade |

> Priscila: "Elas nao precisam acompanhar o que ta acontecendo com as outras profissionais. Cada uma tem um kanban delas."

**Esforco:** Nenhum (configuracao)

---

## Funcionalidades Transversais

### A. Integracao com ERP Infosoft

**Fase 1 (MVP — imediata):** Import massivo via Excel
- Priscila extrai relatorio do ERP em Excel (demora ~2h para extrair toda a base)
- Upload pelo `/contatos` (funcionalidade ja existe)
- Mapeamento de colunas: nome, telefone, endereco, contrato, vendedor, data criacao, etc.
- Priscila vai definir quais colunas do Excel quer ver no CRM

**Fase 2 (posterior):** API de consulta
- Endpoint para buscar dados do cliente pelo numero de contrato em tempo real
- Usado na tela de Vistoria e na busca do CRM
- Depende do Ricardo (desenvolvedor do ERP) disponibilizar API
- ERP e desktop (nao e online), acesso via aplicativo NDK

**Fase 3 (futuro — inicio de 2027 estimado pela Priscila):** Sincronizacao bidirecional
- Novo contato no ERP → aparece no CRM automaticamente
- Aprovacao no CRM → atualiza status no ERP
- Priscila mencionou que tem mais etapas antes: automacao de logistica e automacao comercial

> Priscila: "O CRM e a esteira de atendimento. A gente vai seguindo pelo CRM e passando pro ERP so no momento da aprovacao."
> Priscila: "Pra gente fazer uma aprovacao hoje, sao em media 33 cliques."

### B. Botoes de Avancar/Retroceder Etapa

**Onde:** Painel de detalhes do card no funil

**Por que:** Rodrigo falou que no Trello eles usam botoes de automacao ("Enviar para finalizacao", "Arquivacao", "Devolver para comercial", "Aprovar e enviar para agendamento"). Esses botoes sao mais praticos que arrastar.

**Funcionalidade:**
- Botao "Avancar >" — Move card para proxima etapa na ordem
- Botao "< Devolver" — Move card para etapa anterior
- Botoes de acao especificos por funil (ex: "Enviar para Agendamento" quando na etapa Aprovado)

> Rodrigo: "Se tiver um botao etapa concluida, mandar pro proximo, seria melhor. Esse negocio de arrastar e bom, mas o botaozinho eu acho mais pratico."
> Rodrigo: "Seria legal tambem ter um botao para ir e um botao para voltar."

### C. Transicao entre Funis

**Contexto:** Quando um card e aprovado no Funil Comercial, ele precisa ir para o Funil Agendamento. Quando uma reclamacao chega, precisa ir pro Funil Qualidade.

**Funcionalidade:**
- Botao "Enviar para Agendamento" na etapa Aprovado do funil comercial
- Botao "Devolver para Comercial" no funil de agendamento
- Move o card de um funil para outro, mantendo historico

### D. Visao Individual por Vendedor

**Contexto:** Cada vendedora ve apenas seus proprios cards ao acessar o funil.

**Como funciona:** O sistema ja suporta `viewScope: 'own'` para vendedores (role=seller). Cards filtrados automaticamente por `assignedTo === currentUserId`.

> Priscila: "Cada colaborador de comercial tem ali um kanban delas. Elas nao precisam acompanhar o que ta acontecendo com as outras."

**Esforco:** Nenhum — ja existe via sistema de permissoes.

### E. Campo de Estimativa de Valor

Cada card tera um campo `dealValue` (ja existe na base) com o valor estimado do negocio.

> Lucas: "Cada card tem uma estimativa de valor de negocio. Ai a gente conseguiria saber quantos R$ eu tenho na etapa de finalizacao de venda, quantos R$ eu tenho no calculo."
> Priscila: "Faz sentido. Entrou R$10.000 de negociacao, passei pro cliente, to negociando cinco, aprovei tres e perdi dois."

Esse campo alimenta automaticamente:
- Somatorio por etapa no kanban
- Dashboard de valor por vendedor
- Projecao de vendas

---

## Paginas/Funcionalidades REMOVIDAS (nao se aplicam)

As seguintes paginas do Voxium CRM **nao farao parte** do CRM Solaris:

| Pagina Voxium | Rota | Motivo da remocao |
|---------------|------|-------------------|
| Super Admin | `/super-admin` | Nao e SaaS, nao tem multi-tenant |
| Creditos | `/admin/creditos` | Nao tem sistema de creditos |
| Agente de Voz (VAPI) | `/ligacoes/*` | Nao tera ligacoes automatizadas |
| Configuracao de Agente | `/ligacoes/configuracao` | Nao tera agente de voz |
| Disparo Massivo | `/ligacoes/disparo` | Nao tera ligacoes |
| Historico de Ligacoes | `/ligacoes/historico` | Nao tera ligacoes |
| Cadencia | `/cadencia` | Nao tera cadencia automatizada |
| Automacoes | `/automacoes/*` | Nao tera automacoes de workflow |
| Campanhas | `/campanhas/*` | Nao tera campanhas de email em massa |
| Propostas PDF | `/admin/propostas` | Nao tera gerador de propostas |
| Estrategia Comercial | `/admin/estrategia` | Nao tera playbook |

**Sidebar do CRM Solaris (itens):**
1. Dashboard
2. Contatos
3. Funis
4. Produtividade
5. Conversao
6. Projecao de Vendas
7. Vistoria de Orcamento
8. Configuracoes (usuarios)

---

## Usuarios e Permissoes

| Role | Quem | O que ve | O que pode fazer |
|------|------|----------|------------------|
| admin | Priscila D'Almeida, Rodrigo | Tudo | Tudo (criar funis, usuarios, ver todos os cards, dashboard completo) |
| manager | Equipe Qualidade | Funil de qualidade completo | Gerenciar cards do funil qualidade |
| seller | Vendedoras, Agendadoras | Apenas seus proprios cards | Mover cards, adicionar notas, enviar email |

---

## Cronograma Sugerido

| Semana | Entrega | Esforco |
|--------|---------|---------|
| 1 | Setup do projeto Solaris (fork/deploy), branding, usuarios, 4 funis | Config |
| 1 | Remover paginas que nao se aplicam (sidebar, rotas) | Baixo |
| 1 | Import da base de clientes do Excel do ERP | Config |
| 2 | Campos customizados do setor (contrato, tipo servico, pragas, status, valor) | Baixo |
| 2 | Novos filtros na pagina de contatos (inatividade, faixa valor, contrato, status) | Medio |
| 2 | Botoes avancar/retroceder etapa no painel de detalhes | Baixo |
| 2 | Botao de transicao entre funis (Comercial → Agendamento) | Baixo |
| 3 | Tela de Vistoria de Orcamento (mobile-first, voz, camera, upload) | Alto |
| 3 | 2 graficos novos no dashboard (inatividade, faixa de gasto) | Medio |
| 4 | Testes com equipe Solaris, ajustes, refinamentos | QA |

**Total estimado:** 3-4 semanas de desenvolvimento + 1 semana de ajustes

---

## Resumo de Esforco

| Pagina | Esforco | Detalhes |
|--------|---------|----------|
| Login | Config | Branding Solaris |
| Contatos | Medio | Campos do setor, novos filtros, busca contrato |
| Detalhe Contato | Medio | Secao servicos, campos custom, ajustar filtros log |
| Lista de Funis | Pronto | — |
| Funil Comercial | Baixo-Medio | Botoes avancar/retroceder, routing vendedor |
| Funil Agendamento | Config | Novo funil + etapas |
| Funil Qualidade | Config | Novo funil + etapas |
| Funil Reativacao | Config | Novo funil + etapas |
| **Vistoria de Orcamento** | **Alto** | **Pagina nova (voz, camera, upload)** |
| Produtividade | Pronto | — |
| Dashboard | Medio | 2 graficos novos |
| Projecao Vendas | Pronto | — |
| Conversao | Pronto | — |
| Admin Usuarios | Config | Cadastrar equipe |

**Legenda:**
- **Pronto** = Funciona sem alteracao
- **Config** = Criar dados (funis, usuarios) sem codigo
- **Baixo** = Pequenas alteracoes no codigo
- **Medio** = Funcionalidades novas moderadas
- **Alto** = Pagina nova ou funcionalidade complexa

---

## Dependencias Externas

1. **Priscila:** Enviar Excel com base de clientes do ERP + definir quais colunas quer ver no card
2. **Rodrigo:** Enviar link do Google Forms de vistoria (para usar como base dos campos)
3. **Ricardo (ERP):** Criar usuario Labrego no ERP para acesso + futuramente API de consulta
4. **Priscila:** Definir branding Solaris (logo, cores)

---

## Conclusao

De 14 paginas mapeadas para o CRM Solaris, **8 estao prontas ou so precisam de configuracao**. O desenvolvimento se concentra em:

1. **Campos customizados** no contato — dados do setor de controle de pragas (baixo)
2. **Filtros novos** na pagina de contatos — inatividade, faixa valor, contrato (medio)
3. **Botoes avancar/retroceder** + transicao entre funis (baixo)
4. **Tela de Vistoria de Orcamento** — pagina nova mobile-first com voz e camera (alto)
5. **Graficos novos** no dashboard — inatividade e faixa de gasto (medio)
6. **Remover paginas** que nao se aplicam — sidebar, rotas (baixo)

A base do Voxium CRM atende a estrutura fundamental (kanban, contatos, analytics, produtividade). O investimento principal esta na **Tela de Vistoria** e nos **filtros/campos especificos do setor**.
