// comportamentos das telas (sem framework)
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const html = document.documentElement;
  const soNum = v => String(v || '').replace(/\D/g, '');
  const salvar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  // ---------- sidebar ----------
  document.addEventListener('click', e => {
    if (e.target.closest('[data-recolher]')) {
      const rec = html.classList.toggle('lateral-recolhida');
      salvar('lateral', rec ? 'recolhida' : null);
    }
    if (e.target.closest('[data-abrir-gaveta]')) html.classList.add('gaveta-aberta');
    if (e.target.closest('[data-fechar-gaveta]')) html.classList.remove('gaveta-aberta');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      html.classList.remove('gaveta-aberta');
      $$('details.menu-acoes[open]').forEach(d => d.removeAttribute('open'));
    }
  });

  // ---------- tema ----------
  function textoTema() {
    const escuro = html.getAttribute('data-tema') === 'escuro';
    $$('[data-tema-txt]').forEach(el => { el.textContent = escuro ? 'Modo claro' : 'Modo escuro'; });
  }
  textoTema();
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-tema-toggle]')) return;
    const escuro = html.getAttribute('data-tema') === 'escuro';
    if (escuro) html.removeAttribute('data-tema'); else html.setAttribute('data-tema', 'escuro');
    salvar('tema', escuro ? 'claro' : 'escuro');
    textoTema();
  });

  // ---------- menus (details) fecham ao clicar fora ----------
  document.addEventListener('click', e => {
    $$('details.menu-acoes[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });
  // menu perto do fim da tela abre para cima
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('menu-acoes') || !d.open) return;
    const r = d.getBoundingClientRect();
    d.classList.toggle('para-cima', window.innerHeight - r.bottom < 220 && !d.closest('.lat-rodape'));
  }, true);

  // ---------- toasts ----------
  function fecharToast(t) {
    t.classList.add('saindo');
    setTimeout(() => t.remove(), 200);
  }
  $$('.toast').forEach((t, i) => setTimeout(() => t.isConnected && fecharToast(t), 5000 + i * 600));
  document.addEventListener('click', e => {
    const b = e.target.closest('.toast-fechar');
    if (b) fecharToast(b.closest('.toast'));
  });
  window.toast = function (msg, tipo = 'ok') {
    const box = $('.toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast ' + tipo;
    t.innerHTML = `<span class="ic-toast">${tipo === 'erro' ? '!' : '✓'}</span><div class="toast-txt"></div><button class="toast-fechar" type="button" aria-label="Fechar">×</button>`;
    t.querySelector('.toast-txt').textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.isConnected && fecharToast(t), 5000);
  };

  // ---------- linhas clicaveis ----------
  document.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-href]');
    if (!tr || e.target.closest('a, button, summary, input, select, form, details')) return;
    if (e.ctrlKey || e.metaKey) window.open(tr.dataset.href, '_blank');
    else location.href = tr.dataset.href;
  });

  // ---------- confirmacao e botao com carregamento ----------
  document.addEventListener('submit', e => {
    const form = e.target;
    const msg = form.getAttribute('data-confirma');
    if (msg && !confirm(msg)) { e.preventDefault(); return; }
    if (form.hasAttribute('data-validar') && !validarForm(form)) { e.preventDefault(); return; }
    const btn = e.submitter || form.querySelector('button[type=submit], button:not([type])');
    if (btn && !btn.hasAttribute('data-livre')) {
      setTimeout(() => {
        btn.classList.add('carregando');
        if (btn.dataset.carregando) {
          const span = btn.querySelector('span');
          if (span) span.textContent = btn.dataset.carregando;
        }
      }, 0);
    }
  });

  // ---------- validacao inline ----------
  function msgCampo(campo, txt) {
    const box = campo.closest('.campo');
    if (!box) return;
    let m = box.querySelector('.msg-erro');
    if (!m) { m = document.createElement('div'); m.className = 'msg-erro'; box.appendChild(m); }
    m.textContent = txt || '';
    box.classList.toggle('invalido', !!txt);
  }
  function validarCampo(el) {
    const v = String(el.value || '').trim();
    let erro = '';
    if (el.required && !v) erro = el.dataset.msg || 'Campo obrigatório.';
    else if (v && el.dataset.regra === 'valor') {
      let n = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
      if (!(Number(n) > 0)) erro = 'Informe um valor maior que zero.';
    } else if (v && el.dataset.regra === 'cod6' && soNum(v).length !== 6) erro = 'Precisa ter 6 dígitos (ex.: 010101).';
    else if (v && el.dataset.regra === 'ibge' && soNum(v).length !== 7) erro = 'Código IBGE tem 7 dígitos.';
    else if (v && el.dataset.regra === 'doc' && ![11, 14].includes(soNum(v).length)) erro = 'CPF ou CNPJ incompleto.';
    else if (v && el.type === 'email' && !/^\S+@\S+\.\S+$/.test(v)) erro = 'E-mail inválido.';
    msgCampo(el, erro);
    return !erro;
  }
  function validarForm(form) {
    let primeiro = null;
    $$('input, select, textarea', form).forEach(el => {
      if (el.type === 'hidden' || el.disabled) return;
      if (!validarCampo(el) && !primeiro) primeiro = el;
    });
    if (primeiro) {
      primeiro.focus();
      primeiro.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return false;
    }
    return true;
  }
  $$('form[data-validar]').forEach(form => {
    form.setAttribute('novalidate', '');
    form.addEventListener('blur', e => {
      if (e.target.matches('input, select, textarea') && e.target.type !== 'hidden') validarCampo(e.target);
    }, true);
    form.addEventListener('input', e => {
      if (e.target.closest('.campo.invalido')) validarCampo(e.target);
    });
  });

  // ---------- mascara CPF/CNPJ ----------
  $$('[data-doc]').forEach(inp => {
    inp.addEventListener('input', () => {
      let d = soNum(inp.value).slice(0, 14);
      if (d.length <= 11) d = d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
      else d = d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
      inp.value = d;
    });
  });

  // ---------- CEP (ViaCEP) ----------
  $$('[data-cep]').forEach(inp => {
    const form = inp.form;
    const msg = form.querySelector('[data-cep-msg]');
    inp.addEventListener('input', () => {
      const d = soNum(inp.value).slice(0, 8);
      inp.value = d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
    });
    inp.addEventListener('change', async () => {
      const cep = soNum(inp.value);
      if (cep.length !== 8) return;
      if (msg) msg.textContent = 'Buscando endereço...';
      try {
        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const j = await r.json();
        if (j.erro) throw new Error();
        $$('[data-end]', form).forEach(el => {
          const k = el.getAttribute('data-end');
          if (j[k] && (!el.value || k === 'ibge' || k === 'localidade' || k === 'uf')) {
            el.value = j[k];
            msgCampo(el, '');
          }
        });
        if (msg) msg.textContent = `${j.localidade}/${j.uf} · IBGE ${j.ibge}`;
      } catch (e) {
        if (msg) msg.textContent = 'CEP não encontrado. Preencha o endereço manualmente.';
      }
    });
  });

  // ---------- CNPJ (BrasilAPI) ----------
  $$('[data-busca-cnpj]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const form = btn.form;
      const campo = form.querySelector(btn.getAttribute('data-busca-cnpj'));
      const cnpj = soNum(campo.value);
      if (cnpj.length !== 14) { msgCampo(campo, 'Digite um CNPJ com 14 dígitos para buscar.'); campo.focus(); return; }
      btn.classList.add('carregando');
      try {
        const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
        if (!r.ok) throw new Error();
        const j = await r.json();
        const set = (nome, val) => { const el = form.querySelector(`[name=${nome}]`); if (el && val && !el.value) { el.value = val; msgCampo(el, ''); } };
        set('razao_social', j.razao_social);
        set('nome', j.razao_social);
        set('nome_fantasia', j.nome_fantasia);
        set('email', (j.email || '').toLowerCase());
        set('telefone', j.ddd_telefone_1);
        set('logradouro', [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' '));
        set('numero', j.numero);
        set('complemento', j.complemento);
        set('bairro', j.bairro);
        set('municipio', j.municipio);
        set('uf', j.uf);
        set('cod_municipio', j.codigo_municipio_ibge);
        const cep = form.querySelector('[name=cep]');
        if (cep && j.cep && !cep.value) { cep.value = String(j.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2'); cep.dispatchEvent(new Event('change')); }
        const s = form.querySelector('[name=op_simples]');
        if (s && j.opcao_pelo_mei) s.value = '2';
        else if (s && j.opcao_pelo_simples) s.value = '3';
        window.toast('Dados do CNPJ preenchidos. Confira antes de salvar.');
      } catch (e) {
        window.toast('Não foi possível consultar o CNPJ agora. Preencha manualmente.', 'erro');
      }
      btn.classList.remove('carregando');
    });
  });

  // ---------- grafico: tooltip ----------
  $$('.grafico').forEach(g => {
    const dica = g.querySelector('.grafico-dica');
    if (!dica) return;
    $$('[data-dica-valor]', g).forEach(b => {
      const mostrar = () => {
        const r = b.getBoundingClientRect(), base = g.getBoundingClientRect();
        dica.innerHTML = `${b.dataset.dicaMes}<strong>${b.dataset.dicaValor}</strong>${b.dataset.dicaQtd}`;
        dica.style.left = (r.left - base.left + r.width / 2) + 'px';
        dica.style.top = (Number(b.dataset.dicaTopo) / Number(g.dataset.altura) * base.height) + 'px';
        dica.classList.add('vis');
      };
      b.addEventListener('mouseenter', mostrar);
      b.addEventListener('focus', mostrar);
      b.addEventListener('mouseleave', () => dica.classList.remove('vis'));
      b.addEventListener('blur', () => dica.classList.remove('vis'));
    });
  });

  // ---------- atualiza status das notas que estao na fila ----------
  const pendentes = $$('[data-nota-id]').filter(el => ['pendente', 'processando'].includes(el.getAttribute('data-nota-status')));
  if (pendentes.length) {
    const ids = [...new Set(pendentes.map(el => el.getAttribute('data-nota-id')))];
    let voltas = 0;
    const timer = setInterval(async () => {
      voltas++;
      try {
        const r = await fetch((window.STATUS_URL || '/notas/status.json') + '?ids=' + ids.join(','));
        const lista = await r.json();
        let mudou = false;
        lista.forEach(n => {
          $$(`[data-nota-id="${n.id}"]`).forEach(el => {
            if (el.getAttribute('data-nota-status') === n.status) return;
            mudou = true;
            const b = el.querySelector('.badge');
            if (b) { b.className = 'badge ' + n.status_cls; b.textContent = n.status_txt; b.setAttribute('data-status', n.status); }
            el.setAttribute('data-nota-status', n.status);
          });
        });
        const aindaFila = lista.some(n => n.status === 'pendente' || n.status === 'processando');
        if (mudou && document.body.hasAttribute('data-recarregar')) location.reload();
        if (!aindaFila || voltas > 60) clearInterval(timer);
      } catch (e) { clearInterval(timer); }
    }, 2500);
  }
})();
