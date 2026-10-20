// =====================================================================
//  ESCALA POSTO TREVO · servidor (Google Apps Script)
//  - Só o administrador (Rafael) altera e publica a escala.
//  - Cada colaborador entra com nome + PIN e recebe SOMENTE a própria escala.
//  - Senhas e PINs ficam guardados em hash (nunca em texto aberto).
//  - Depois de 5 tentativas erradas, o login daquele nome fica travado por 15 minutos.
// =====================================================================

// 1) Antes de executar configurar() pela primeira vez, escreva aqui a sua senha de administrador
//    (mínimo 8 caracteres). Depois de executar, APAGUE a senha desta linha e salve de novo.
const SENHA_ADMIN_INICIAL = '';

const TENTATIVAS_MAX = 5;          // tentativas erradas antes de travar
const TRAVA_SEGUNDOS = 15 * 60;     // tempo de trava
const HORAS_TOKEN_ADMIN = 12;       // o administrador entra de novo a cada 12h
const HORAS_TOKEN_COLAB = 24 * 60;  // o colaborador fica conectado por 60 dias (até você trocar o PIN ou bloquear)

// ---------------------------------------------------------------------
// Configuração inicial: execute UMA vez no editor (botão ▶ Executar)
// ---------------------------------------------------------------------
function configurar() {
  garantirAba_('Colaboradores', ['id', 'nome', 'setor', 'salt', 'hash', 'ativo', 'atualizadoEm']);
  garantirAba_('Publicadas', ['mes', 'id', 'nome', 'dados', 'publicadoEm']);
  garantirAba_('Meses', ['mes', 'modelo', 'colaboradores', 'publicadoEm']);
  garantirAba_('Estado', ['parte', 'conteudo']);
  garantirAba_('Acessos', ['quando', 'quem', 'acao', 'resultado']);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SEGREDO')) props.setProperty('SEGREDO', Utilities.getUuid() + Utilities.getUuid());

  if (SENHA_ADMIN_INICIAL) {
    if (SENHA_ADMIN_INICIAL.length < 8) throw new Error('A senha de administrador precisa ter pelo menos 8 caracteres.');
    const salt = Utilities.getUuid();
    props.setProperty('ADMIN_SALT', salt);
    props.setProperty('ADMIN_HASH', hash_(salt, SENHA_ADMIN_INICIAL));
    Logger.log('Pronto! Senha de administrador definida. Agora APAGUE a senha da linha SENHA_ADMIN_INICIAL e salve o arquivo.');
  } else if (!props.getProperty('ADMIN_HASH')) {
    throw new Error('Escreva a sua senha em SENHA_ADMIN_INICIAL (linha 13) antes de executar configurar().');
  } else {
    Logger.log('Abas conferidas. A senha de administrador continua a mesma.');
  }
}

// ---------------------------------------------------------------------
// Entrada da API
// ---------------------------------------------------------------------
function doGet() {
  return saida_({ ok: true, app: 'Escala Posto Trevo', versao: 1 });
}

function doPost(e) {
  let resposta;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    resposta = rotear_(req);
  } catch (err) {
    resposta = { ok: false, erro: String((err && err.message) || err) };
  }
  return saida_(resposta);
}

function rotear_(req) {
  const acao = String(req.acao || '');
  // --- públicas (sem login) ---
  if (acao === 'nomes') return nomes_();
  if (acao === 'loginColab') return loginColab_(req);
  if (acao === 'loginAdmin') return loginAdmin_(req);

  // --- precisam de login ---
  const t = lerToken_(req.token);
  if (!t) return { ok: false, erro: 'Sessão expirada. Entre de novo.', sair: true };

  if (acao === 'minhaEscala') {
    if (t.papel !== 'colab') return { ok: false, erro: 'Acesso negado.' };
    return minhaEscala_(t.id, req.mes);
  }

  // daqui pra baixo, só o administrador
  if (t.papel !== 'admin') return { ok: false, erro: 'Acesso negado. Somente o administrador pode alterar a escala.' };
  switch (acao) {
    case 'estadoCarregar': return estadoCarregar_();
    case 'estadoSalvar': return comTrava_(() => estadoSalvar_(req));
    case 'publicar': return comTrava_(() => publicar_(req));
    case 'despublicar': return comTrava_(() => despublicar_(req));
    case 'mesesPublicados': return { ok: true, meses: mesesPublicados_() };
    case 'acessos': return acessos_();
    case 'definirPin': return comTrava_(() => definirPin_(req));
    case 'ativar': return comTrava_(() => ativar_(req));
    case 'trocarSenhaAdmin': return comTrava_(() => trocarSenhaAdmin_(req));
    default: return { ok: false, erro: 'Ação desconhecida: ' + acao };
  }
}

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
function loginAdmin_(req) {
  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty('ADMIN_SALT'), h = props.getProperty('ADMIN_HASH');
  if (!h) return { ok: false, erro: 'Servidor ainda não configurado. Execute configurar() no editor.' };
  if (travado_('admin')) return { ok: false, erro: 'Muitas tentativas erradas. Tente de novo em 15 minutos.' };
  if (hash_(salt, String(req.senha || '')) !== h) {
    falhou_('admin');
    registrar_('administrador', 'login', 'senha errada');
    return { ok: false, erro: 'Senha incorreta.' };
  }
  limpar_('admin');
  registrar_('administrador', 'login', 'ok');
  return { ok: true, token: criarToken_({ papel: 'admin', v: h.slice(0, 12) }, HORAS_TOKEN_ADMIN) };
}

function loginColab_(req) {
  const id = Number(req.id);
  const chave = 'colab' + id;
  if (travado_(chave)) return { ok: false, erro: 'Muitas tentativas erradas. Tente de novo em 15 minutos.' };
  const c = colaborador_(id);
  if (!c || !c.hash) { falhou_(chave); return { ok: false, erro: 'Nome ou PIN incorreto.' }; }
  if (!c.ativo) { registrar_(c.nome, 'login', 'bloqueado'); return { ok: false, erro: 'Seu acesso está bloqueado. Fale com a gerência.' }; }
  if (hash_(c.salt, String(req.pin || '')) !== c.hash) {
    falhou_(chave);
    registrar_(c.nome, 'login', 'PIN errado');
    return { ok: false, erro: 'Nome ou PIN incorreto.' };
  }
  limpar_(chave);
  registrar_(c.nome, 'login', 'ok');
  return { ok: true, token: criarToken_({ papel: 'colab', id: id, v: c.hash.slice(0, 12) }, HORAS_TOKEN_COLAB), nome: c.nome, setor: c.setor };
}

// Lista de nomes para a tela de login (só quem tem PIN e está ativo)
function nomes_() {
  const lista = linhas_('Colaboradores')
    .filter(c => c.hash && c.ativo)
    .map(c => ({ id: c.id, nome: c.nome, setor: c.setor }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  return { ok: true, nomes: lista };
}

// ---------------------------------------------------------------------
// Colaborador: só a própria escala
// ---------------------------------------------------------------------
function minhaEscala_(id, mesPedido) {
  const minhas = linhas_('Publicadas').filter(r => Number(r.id) === Number(id));
  const meses = minhas.map(r => String(r.mes)).filter((m, i, a) => a.indexOf(m) === i).sort();
  if (!meses.length) return { ok: true, meses: [], mes: null, dados: null };
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM');
  let mes = String(mesPedido || '');
  if (meses.indexOf(mes) < 0) mes = meses.indexOf(hoje) >= 0 ? hoje : meses.filter(m => m <= hoje).pop() || meses[0];
  const linha = minhas.filter(r => String(r.mes) === mes).pop();
  return { ok: true, meses: meses, mes: mes, dados: JSON.parse(linha.dados), publicadoEm: linha.publicadoEm };
}

// ---------------------------------------------------------------------
// Administrador
// ---------------------------------------------------------------------
// O app de gestão guarda todo o estado (funcionários, ajustes, regras) aqui, para abrir igual em qualquer aparelho.
// O número de versão impede que um aparelho com dados velhos apague o que outro salvou.
function estadoCarregar_() {
  const props = PropertiesService.getScriptProperties();
  const partes = aba_('Estado').getDataRange().getValues().slice(1).sort((a, b) => a[0] - b[0]).map(r => r[1]).join('');
  return { ok: true, estado: partes || null, versao: Number(props.getProperty('ESTADO_VERSAO') || 0) };
}

function estadoSalvar_(req) {
  const props = PropertiesService.getScriptProperties();
  const atual = Number(props.getProperty('ESTADO_VERSAO') || 0);
  if (!req.forcar && Number(req.base) !== atual) {
    return { ok: false, conflito: true, versao: atual, erro: 'A escala foi alterada em outro aparelho.' };
  }
  const texto = String(req.estado || '');
  const sh = aba_('Estado');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  const pedacos = [];
  for (let i = 0; i < texto.length; i += 40000) pedacos.push([pedacos.length, texto.slice(i, i + 40000)]);
  if (pedacos.length) sh.getRange(2, 1, pedacos.length, 2).setValues(pedacos);
  const nova = atual + 1;
  props.setProperty('ESTADO_VERSAO', String(nova));
  return { ok: true, versao: nova };
}

// Recebe a escala pronta de um mês (uma linha por colaborador) e substitui a publicação anterior desse mês.
function publicar_(req) {
  const mes = String(req.mes || '');
  if (!/^\d{4}-\d{2}$/.test(mes)) return { ok: false, erro: 'Mês inválido.' };
  const lista = Array.isArray(req.colaboradores) ? req.colaboradores : [];
  if (!lista.length) return { ok: false, erro: 'Nenhum colaborador para publicar.' };
  const agora = new Date();

  removerLinhas_('Publicadas', r => String(r.mes) === mes);
  const sh = aba_('Publicadas');
  const novas = lista.map(c => [mes, Number(c.id), String(c.nome), JSON.stringify(c), agora]);
  sh.getRange(sh.getLastRow() + 1, 1, novas.length, 5).setNumberFormat('@').setValues(novas);
  sh.getRange(2, 5, sh.getLastRow() - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm');

  removerLinhas_('Meses', r => String(r.mes) === mes);
  const shm = aba_('Meses');
  shm.getRange(shm.getLastRow() + 1, 1, 1, 4).setNumberFormat('@').setValues([[mes, String(req.modelo || ''), lista.length, agora]]);

  // mantém nome e setor dos colaboradores em dia (sem mexer no PIN)
  lista.forEach(c => upsertColaborador_(Number(c.id), { nome: String(c.nome), setor: String(c.setor) }));
  registrar_('administrador', 'publicou ' + mes, lista.length + ' colaboradores');
  return { ok: true, mes: mes, colaboradores: lista.length };
}

function despublicar_(req) {
  const mes = String(req.mes || '');
  removerLinhas_('Publicadas', r => String(r.mes) === mes);
  removerLinhas_('Meses', r => String(r.mes) === mes);
  registrar_('administrador', 'despublicou ' + mes, 'ok');
  return { ok: true };
}

function mesesPublicados_() {
  return linhas_('Meses').map(r => ({ mes: String(r.mes), modelo: r.modelo, colaboradores: r.colaboradores, publicadoEm: r.publicadoEm }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
}

function acessos_() {
  const ultimos = {};
  linhas_('Acessos').forEach(a => { if (a.acao === 'login' && a.resultado === 'ok') ultimos[a.quem] = a.quando; });
  return {
    ok: true,
    colaboradores: linhas_('Colaboradores').map(c => ({
      id: c.id, nome: c.nome, setor: c.setor, temPin: !!c.hash, ativo: !!c.ativo,
      ultimoAcesso: ultimos[c.nome] ? Utilities.formatDate(new Date(ultimos[c.nome]), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') : ''
    })),
    meses: mesesPublicados_()
  };
}

// Define (ou troca) o PIN de um colaborador. Trocar o PIN derruba as sessões abertas dele.
function definirPin_(req) {
  const pin = String(req.pin || '');
  if (!/^\d{4,8}$/.test(pin)) return { ok: false, erro: 'O PIN precisa ter de 4 a 8 números.' };
  const salt = Utilities.getUuid();
  upsertColaborador_(Number(req.id), { nome: String(req.nome || ''), setor: String(req.setor || ''), salt: salt, hash: hash_(salt, pin), ativo: true });
  limpar_('colab' + Number(req.id));
  registrar_('administrador', 'definiu PIN', String(req.nome || req.id));
  return { ok: true };
}

// Bloqueia ou libera o acesso (ex.: quando alguém sai do posto)
function ativar_(req) {
  const c = colaborador_(Number(req.id));
  if (!c) return { ok: false, erro: 'Colaborador não encontrado.' };
  upsertColaborador_(Number(req.id), { ativo: !!req.ativo });
  registrar_('administrador', req.ativo ? 'liberou acesso' : 'bloqueou acesso', c.nome);
  return { ok: true };
}

function trocarSenhaAdmin_(req) {
  const props = PropertiesService.getScriptProperties();
  if (hash_(props.getProperty('ADMIN_SALT'), String(req.atual || '')) !== props.getProperty('ADMIN_HASH')) return { ok: false, erro: 'Senha atual incorreta.' };
  if (String(req.nova || '').length < 8) return { ok: false, erro: 'A nova senha precisa ter pelo menos 8 caracteres.' };
  const salt = Utilities.getUuid();
  props.setProperty('ADMIN_SALT', salt);
  props.setProperty('ADMIN_HASH', hash_(salt, String(req.nova)));
  registrar_('administrador', 'trocou a senha', 'ok');
  return { ok: true, sair: true };
}

// ---------------------------------------------------------------------
// Segurança
// ---------------------------------------------------------------------
function hash_(salt, senha) {
  let bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + '|' + String(senha), Utilities.Charset.UTF_8);
  const sal = Utilities.newBlob(String(salt)).getBytes();
  for (let i = 0; i < 300; i++) bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes.concat(sal));
  return Utilities.base64Encode(bytes);
}

function segredo_() {
  const s = PropertiesService.getScriptProperties().getProperty('SEGREDO');
  if (!s) throw new Error('Servidor ainda não configurado. Execute configurar() no editor.');
  return s;
}

function assinar_(texto) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, segredo_()));
}

function criarToken_(dados, horas) {
  dados.exp = Date.now() + horas * 3600 * 1000;
  const corpo = Utilities.base64EncodeWebSafe(JSON.stringify(dados));
  return corpo + '.' + assinar_(corpo);
}

// Confere a assinatura, a validade e se o PIN/senha não mudou desde o login
function lerToken_(token) {
  if (!token) return null;
  const partes = String(token).split('.');
  if (partes.length !== 2 || assinar_(partes[0]) !== partes[1]) return null;
  let d;
  try { d = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString()); } catch (e) { return null; }
  if (!d.exp || d.exp < Date.now()) return null;
  if (d.papel === 'admin') {
    const h = PropertiesService.getScriptProperties().getProperty('ADMIN_HASH') || '';
    return h.slice(0, 12) === d.v ? d : null;
  }
  if (d.papel === 'colab') {
    const c = colaborador_(Number(d.id));
    return c && c.ativo && c.hash && c.hash.slice(0, 12) === d.v ? d : null;
  }
  return null;
}

function travado_(chave) { return Number(CacheService.getScriptCache().get('falhas_' + chave) || 0) >= TENTATIVAS_MAX; }
function falhou_(chave) {
  const c = CacheService.getScriptCache();
  c.put('falhas_' + chave, String(Number(c.get('falhas_' + chave) || 0) + 1), TRAVA_SEGUNDOS);
}
function limpar_(chave) { CacheService.getScriptCache().remove('falhas_' + chave); }

function comTrava_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, erro: 'Servidor ocupado. Tente de novo em alguns segundos.' };
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------------
// Planilha
// ---------------------------------------------------------------------
function planilha_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function garantirAba_(nome, cabecalho) {
  const ss = planilha_();
  let sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function aba_(nome) {
  const sh = planilha_().getSheetByName(nome);
  if (!sh) throw new Error('Aba "' + nome + '" não encontrada. Execute configurar() no editor.');
  return sh;
}

function linhas_(nome) {
  const v = aba_(nome).getDataRange().getValues();
  const cab = v.shift() || [];
  return v.filter(r => r.join('') !== '').map(r => {
    const o = {};
    cab.forEach((c, i) => { o[c] = r[i]; });
    return o;
  });
}

function removerLinhas_(nome, condicao) {
  const sh = aba_(nome);
  const v = sh.getDataRange().getValues();
  const cab = v[0];
  for (let i = v.length - 1; i >= 1; i--) {
    const o = {};
    cab.forEach((c, j) => { o[c] = v[i][j]; });
    if (condicao(o)) sh.deleteRow(i + 1);
  }
}

function colaborador_(id) {
  return linhas_('Colaboradores').filter(c => Number(c.id) === Number(id)).map(c => ({
    id: Number(c.id), nome: String(c.nome), setor: String(c.setor), salt: String(c.salt || ''), hash: String(c.hash || ''),
    ativo: c.ativo === true || String(c.ativo).toUpperCase() === 'TRUE'
  }))[0] || null;
}

function upsertColaborador_(id, campos) {
  const sh = aba_('Colaboradores');
  const v = sh.getDataRange().getValues();
  const cab = v[0];
  let linha = -1;
  for (let i = 1; i < v.length; i++) if (Number(v[i][0]) === id) { linha = i; break; }
  const atual = linha > 0 ? v[linha].slice() : cab.map(() => '');
  atual[0] = id;
  Object.keys(campos).forEach(k => { const j = cab.indexOf(k); if (j >= 0 && campos[k] !== '' && campos[k] !== undefined) atual[j] = campos[k]; });
  if (linha < 0 && atual[cab.indexOf('ativo')] === '') atual[cab.indexOf('ativo')] = true;
  atual[cab.indexOf('atualizadoEm')] = new Date();
  if (linha > 0) sh.getRange(linha + 1, 1, 1, cab.length).setValues([atual]);
  else sh.appendRow(atual);
}

function registrar_(quem, acao, resultado) {
  try {
    const sh = aba_('Acessos');
    sh.appendRow([new Date(), quem, acao, resultado]);
    if (sh.getLastRow() > 3000) sh.deleteRows(2, 500); // guarda só os registros mais recentes
  } catch (e) { /* registro é opcional */ }
}

function saida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
