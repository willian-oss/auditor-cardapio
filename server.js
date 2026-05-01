const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/analisar', async (req, res) => {
  const { url } = req.body;
  const resultado = {
    score: 0,
    totalItens: 0,
    itensComFoto: 0,
    itensSemFoto: [],
    problemas: [],
    recomendacoes: [],
    analiseImagens: {}
  };

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15');
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(3000);

    const dados = await page.evaluate(() => {
      const produtos = [];
      const elementos = document.querySelectorAll(
        'div[class*="product"], div[class*="item"], div[class*="card"], ' +
        'li[class*="menu"], article, .food-item, .dish, ' +
        '.menu-item, [data-product], .product-card'
      );

      elementos.forEach(el => {
        const nome = el.querySelector('h1, h2, h3, h4, strong, .title, .name, .product-name');
        const img = el.querySelector('img');
        const preco = el.querySelector('[class*="price"], [class*="preco"], .value, .product-price');
        const descricao = el.querySelector('p, .description, .desc, span[class*="desc"]');

        if (nome || img) {
          produtos.push({
            nome: nome ? nome.textContent.trim().substring(0, 100) : 'Sem nome',
            temFoto: !!img,
            urlImagem: img ? img.src : null,
            preco: preco ? preco.textContent.trim() : 'Não encontrado',
            temDescricao: !!(descricao && descricao.textContent.trim().length > 10)
          });
        }
      });

      if (produtos.length === 0) {
        const todasImagens = document.querySelectorAll('img');
        const todasDivs = document.querySelectorAll('div, section, article, li');
        
        todasDivs.forEach(el => {
          const img = el.querySelector('img');
          const texto = el.textContent.trim().substring(0, 100);
          if (img && texto && texto.length < 200) {
            produtos.push({
              nome: texto.split('\n')[0].substring(0, 80),
              temFoto: true,
              urlImagem: img.src,
              preco: 'Verificar',
              temDescricao: texto.length > 30
            });
          }
        });
      }

      return produtos;
    });

    resultado.totalItens = dados.length;
    resultado.itensComFoto = dados.filter(i => i.temFoto).length;
    resultado.itensSemFoto = dados.filter(i => !i.temFoto).map(i => i.nome);

    resultado.analiseImagens = {
      total: resultado.totalItens,
      comFoto: resultado.itensComFoto,
      semFoto: resultado.itensSemFoto.length,
      porcentagemComFoto: resultado.totalItens > 0 
        ? ((resultado.itensComFoto / resultado.totalItens) * 100).toFixed(1) 
        : 0,
      score: 0
    };

    if (resultado.analiseImagens.porcentagemComFoto >= 90) resultado.analiseImagens.score = 100;
    else if (resultado.analiseImagens.porcentagemComFoto >= 70) resultado.analiseImagens.score = 70;
    else if (resultado.analiseImagens.porcentagemComFoto >= 50) resultado.analiseImagens.score = 50;
    else resultado.analiseImagens.score = 20;

    if (resultado.itensComFoto === 0) {
      resultado.problemas.push({
        tipo: 'IMAGENS',
        gravidade: 'CRÍTICO',
        descricao: 'NENHUM item possui foto no cardápio',
        impacto: 'Itens sem foto vendem até 60% menos',
        correcao: 'Adicionar fotos profissionais de todos os pratos'
      });
      resultado.score -= 40;
    } else if (resultado.analiseImagens.porcentagemComFoto < 50) {
      resultado.problemas.push({
        tipo: 'IMAGENS',
        gravidade: 'ALTA',
        descricao: `Apenas ${resultado.analiseImagens.porcentagemComFoto}% dos itens têm foto`,
        impacto: 'Mais da metade do cardápio está invisível para o cliente',
        correcao: 'Priorizar fotos dos itens mais vendidos'
      });
      resultado.score -= 20;
    }

    const temDescricao = dados.filter(i => i.temDescricao).length;
    if (temDescricao < resultado.totalItens * 0.5) {
      resultado.problemas.push({
        tipo: 'DESCRIÇÃO',
        gravidade: 'MÉDIA',
        descricao: 'Muitos itens sem descrição detalhada',
        correcao: 'Adicionar descrições com ingredientes e modo de preparo'
      });
      resultado.score -= 10;
    }

    const mobileCheck = await page.evaluate(() => {
      const problemas = [];
      const buttons = document.querySelectorAll('button, a, [role="button"]');
      let botoesPequenos = 0;
      
      buttons.forEach(btn => {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
          botoesPequenos++;
        }
      });

      return {
        temHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
        botoesPequenos: botoesPequenos,
        fontSize: parseFloat(window.getComputedStyle(document.body).fontSize)
      };
    });

    if (mobileCheck.temHorizontalScroll) {
      resultado.problemas.push({
        tipo: 'MOBILE',
        gravidade: 'CRÍTICO',
        descricao: 'Cardápio não está adaptado para celular (scroll horizontal)',
        impacto: '70% dos acessos são mobile',
        correcao: 'Implementar design responsivo'
      });
      resultado.score -= 25;
    }

    if (mobileCheck.botoesPequenos > 3) {
      resultado.problemas.push({
        tipo: 'MOBILE',
        gravidade: 'ALTA',
        descricao: `${mobileCheck.botoesPequenos} botões muito pequenos para toque`,
        correcao: 'Aumentar botões para mínimo 44x44px'
      });
      resultado.score -= 10;
    }

    resultado.score += 100;
    resultado.score = Math.max(0, Math.min(100, Math.round(resultado.score)));

    if (resultado.score >= 80) {
      resultado.recomendacoes.push({
        prioridade: 'BAIXA',
        acao: 'Cardápio bem otimizado',
        detalhe: 'Manter boas práticas e monitorar desempenho',
        impacto: 'Manutenção da taxa de conversão atual'
      });
    }

    if (resultado.itensSemFoto.length > 0) {
      resultado.recomendacoes.push({
        prioridade: 'ALTA',
        acao: 'Contratar fotógrafo profissional',
        detalhe: `${resultado.itensSemFoto.length} itens precisam de fotos reais`,
        impacto: 'Aumento estimado de 40-60% nas vendas desses itens'
      });
    }

    resultado.recomendacoes.push({
      prioridade: 'MÉDIA',
      acao: 'Melhorar descrições dos pratos',
      detalhe: 'Usar linguagem sensorial e listar ingredientes',
      impacto: 'Melhor decisão de compra do cliente'
    });

    if (resultado.problemas.length === 0) {
      resultado.problemas.push({
        tipo: 'GERAL',
        gravidade: 'BAIXA',
        descricao: 'Nenhum problema crítico detectado automaticamente',
        correcao: 'Recomenda-se auditoria manual complementar'
      });
    }

    res.json({ sucesso: true, dados: resultado });
    
  } catch (error) {
    console.error('Erro:', error.message);
    res.json({
      sucesso: false,
      dados: {
        score: 0,
        totalItens: 0,
        itensComFoto: 0,
        itensSemFoto: [],
        problemas: [{
          tipo: 'ACESSO',
          gravidade: 'CRÍTICO',
          descricao: 'Não foi possível acessar o cardápio automaticamente',
          correcao: 'Verifique se a URL está correta e se o site permite acesso automatizado'
        }],
        recomendacoes: [{
          prioridade: 'ALTA',
          acao: 'Análise manual necessária',
          detalhe: 'O site pode ter proteção contra robôs. Tente analisar manualmente.',
          impacto: 'Indisponível'
        }],
        analiseImagens: { total: 0, comFoto: 0, semFoto: 0, porcentagemComFoto: 0, score: 0 }
      }
    });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
