// Página de download do NEXUS: detecta o aparelho e mostra o caminho certo.
(function () {
  'use strict';
  var cfg = window.NEXUS_SITE || {};
  var repo = (cfg.repo || '').trim();
  var appUrl = cfg.appUrl || './app/';
  var ua = navigator.userAgent;
  var touch = navigator.maxTouchPoints || 0;

  var isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (touch > 0 || 'ontouchend' in document));
  var isIOS = /iPhone|iPod/.test(ua) || isIPad;
  var isAndroid = /Android/i.test(ua);
  var isWindows = /Windows NT/.test(ua) && !isAndroid;
  var isMac = /Macintosh/.test(ua) && !isIPad;
  var inSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);

  var winUrl = repo ? 'https://github.com/' + repo + '/releases/latest/download/NEXUS-Setup.exe' : '';
  var apkUrl = repo ? 'https://github.com/' + repo + '/releases/latest/download/NEXUS.apk' : '';

  var $ = function (id) {
    return document.getElementById(id);
  };

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  var icons = {
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14"/></svg>',
    open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M8 7l4-4 4 4M7 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
    plusSquare: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="18.5" r="1.7" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    safari: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" fill="currentColor"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="9.5" y="7" width="5" height="5" rx="1.3" fill="currentColor"/></svg>',
  };

  function button(label, href, kind, icon, opts) {
    opts = opts || {};
    if (!href) {
      return '<span class="btn btn-' + kind + ' is-disabled" aria-disabled="true">' + icon + '<span>' + label + '</span></span>';
    }
    return (
      '<a class="btn btn-' + kind + '" href="' + href + '"' + (opts.download ? ' download' : '') + (opts.external ? ' rel="noopener"' : '') + '>' + icon + '<span>' + label + '</span></a>'
    );
  }

  function steps(list) {
    return (
      '<ol class="steps">' +
      list
        .map(function (s, i) {
          return '<li><span class="step-n">' + (i + 1) + '</span><span class="step-icon">' + s.icon + '</span><span class="step-text">' + s.text + '</span></li>';
        })
        .join('') +
      '</ol>'
    );
  }

  function iosGuide(device) {
    var where = device === 'ipad' ? 'no canto superior direito do Safari' : 'na barra de baixo do Safari';
    return (
      '<h2 id="guia-ios">Instalar no ' + (device === 'ipad' ? 'iPad' : 'iPhone') + '</h2>' +
      '<p class="muted">No ' + (device === 'ipad' ? 'iPad' : 'iPhone') + ' o NEXUS é instalado pela Tela de Início: abre em tela cheia, com ícone próprio e notificações (iOS 16.4 ou mais novo).</p>' +
      steps([
        { icon: icons.safari, text: '<b>Abra o NEXUS no Safari</b> tocando no botão abaixo.' + (inSafari || !isIOS ? '' : ' <span class="warn">Você está em outro navegador: copie o link e abra no Safari.</span>') },
        { icon: icons.share, text: 'Toque em <b>Compartilhar</b> (quadrado com a seta para cima) ' + where + '.' },
        { icon: icons.plusSquare, text: 'Role a lista e toque em <b>Adicionar à Tela de Início</b>.' },
        { icon: icons.check, text: 'Toque em <b>Adicionar</b>. Depois abra o NEXUS pelo ícone na tela inicial e permita microfone e notificações quando ele pedir.' },
      ]) +
      '<div class="guide-actions">' +
      button('Abrir o NEXUS no Safari', appUrl, 'primary', icons.open) +
      '<button class="btn btn-ghost" type="button" id="copy-link">Copiar link</button>' +
      '</div>'
    );
  }

  function androidGuide() {
    return (
      '<h2 id="guia-android">Instalar no Android</h2>' +
      '<p class="muted">Recomendado: instalar pelo Chrome. O app aparece na gaveta de aplicativos e se atualiza sozinho.</p>' +
      steps([
        { icon: icons.open, text: 'Toque em <b>Abrir e instalar</b> (abre o NEXUS no Chrome).' },
        { icon: icons.dots, text: 'Toque no menu <b>⋮</b> e depois em <b>Instalar app</b> (em alguns aparelhos: “Adicionar à tela inicial”).' },
        { icon: icons.check, text: 'Confirme em <b>Instalar</b> e abra o NEXUS pela gaveta de apps.' },
      ]) +
      '<div class="guide-actions">' +
      button('Abrir e instalar', appUrl, 'primary', icons.open) +
      (cfg.apkAvailable ? button('Baixar APK', apkUrl, 'secondary', icons.download, { download: true }) : '') +
      '</div>' +
      '<p class="small">Sobre o APK: desde 30/09/2026 o Android no Brasil exige verificação do desenvolvedor para apps fora da Play Store. Se o celular bloquear o APK, use a instalação pelo Chrome.</p>'
    );
  }

  function render() {
    var primary = $('primary');
    var note = $('primary-note');
    var detected = $('detected');
    var guide = $('guide');

    if (isWindows) {
      detected.textContent = 'Você está no Windows';
      primary.innerHTML =
        (cfg.windowsAvailable ? button(winUrl ? 'Baixar para Windows' : 'Download disponível em breve', winUrl, 'primary btn-lg', icons.download, { download: true }) : '') +
        button('Usar no navegador', appUrl, 'ghost btn-lg', icons.open);
      note.innerHTML = winUrl
        ? 'Windows 10 ou 11 (64 bits) · instala em segundos, sem precisar de administrador.<br>Se aparecer “O Windows protegeu o computador”, clique em <b>Mais informações</b> → <b>Executar assim mesmo</b>.'
        : 'O instalador será publicado aqui assim que a primeira versão for lançada. Enquanto isso, use no navegador.';
    } else if (isIOS) {
      detected.textContent = isIPad ? 'Você está no iPad' : 'Você está no iPhone';
      primary.innerHTML = button('Abrir o NEXUS no Safari', appUrl, 'primary btn-lg', icons.open);
      note.textContent = 'Depois é só adicionar à Tela de Início — veja o passo a passo abaixo.';
      guide.innerHTML = iosGuide(isIPad ? 'ipad' : 'iphone');
      guide.hidden = false;
    } else if (isAndroid) {
      detected.textContent = 'Você está no Android';
      primary.innerHTML = button('Abrir e instalar', appUrl, 'primary btn-lg', icons.open) + (cfg.apkAvailable ? button('Baixar APK', apkUrl, 'ghost btn-lg', icons.download, { download: true }) : '');
      note.textContent = 'Recomendado: instalar pelo Chrome (menu ⋮ → Instalar app).';
      guide.innerHTML = androidGuide();
      guide.hidden = false;
    } else {
      detected.textContent = isMac ? 'Você está no Mac' : 'Você está no computador';
      primary.innerHTML = button('Usar no navegador', appUrl, 'primary btn-lg', icons.open) + (cfg.windowsAvailable ? button('Baixar para Windows', winUrl, 'ghost btn-lg', icons.download, { download: true }) : '');
      note.textContent = isMac ? 'O app instalável para Mac ainda não existe — no navegador funciona tudo, inclusive calls e compartilhar tela.' : 'Funciona no Chrome, Edge e Firefox atualizados.';
    }

    // Botões dos cartões
    document.querySelectorAll('[data-download="windows"]').forEach(function (a) {
      if (winUrl) {
        a.setAttribute('href', winUrl);
        a.setAttribute('download', '');
      } else {
        a.classList.add('is-disabled');
        a.setAttribute('aria-disabled', 'true');
        a.removeAttribute('href');
        a.textContent = 'Em breve';
      }
    });
    document.querySelectorAll('[data-show-guide]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var which = a.getAttribute('data-show-guide');
        guide.innerHTML = which === 'android' ? androidGuide() : iosGuide(which);
        guide.hidden = false;
        bindCopy();
        guide.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    ['open-web', 'open-web-top'].forEach(function (id) {
      var a = $(id);
      if (a) a.setAttribute('href', appUrl);
    });
    if (cfg.version) $('version').textContent = 'v' + cfg.version;
    bindCopy();
  }

  function bindCopy() {
    var b = $('copy-link');
    if (!b) return;
    b.onclick = function () {
      var link = new URL(appUrl, location.href).toString();
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
        .then(function () {
          b.textContent = 'Link copiado!';
        })
        .catch(function () {
          prompt('Copie o link:', link);
        });
    };
  }

  function renderQr() {
    var box = $('qr');
    if (!box || typeof window.qrcode !== 'function') return;
    try {
      var q = window.qrcode(0, 'M');
      q.addData(location.href.split('#')[0]);
      q.make();
      box.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch (e) {
      box.textContent = location.href;
    }
  }

  render();
  renderQr();
})();
