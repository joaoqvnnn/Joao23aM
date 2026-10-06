require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const app = express();
const PORT = process.env.PORT || 3000;

// ====== CONFIGURAÇÃO DO MERCADO PAGO ======
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});
const payment = new Payment(client);

// ====== MIDDLEWARES ======
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== ROTA 1: CRIAR PAGAMENTO PIX ======
app.post('/api/create-pix', async (req, res) => {
  try {
    const { valor, email, nome, txid } = req.body;

    // Validações - AGORA ACEITA A PARTIR DE R$ 0,01
    if (valor === undefined || valor === null || isNaN(valor) || Number(valor) < 0.01) {
      return res.status(400).json({ erro: 'Valor inválido. Mínimo R$ 0,01.' });
    }
    if (Number(valor) > 100000) {
      return res.status(400).json({ erro: 'Valor máximo permitido: R$ 100.000,00.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ erro: 'E-mail inválido. É obrigatório para o PIX.' });
    }

    const idempotencyKey = txid || `PIX-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const body = {
      transaction_amount: Number(Number(valor).toFixed(2)),
      description: 'Compra na Loja Digital',
      payment_method_id: 'pix',
      payer: {
        email: email,
        first_name: nome || 'Cliente',
      },
      external_reference: idempotencyKey,
      notification_url: `${process.env.BASE_URL}/api/webhook`,
    };

    const result = await payment.create({
      body,
      requestOptions: { idempotencyKey },
    });

    const pixData = result.point_of_interaction?.transaction_data;

    res.json({
      sucesso: true,
      payment_id: result.id,
      status: result.status,
      status_detail: result.status_detail,
      qr_code: pixData?.qr_code || '',
      qr_code_base64: pixData?.qr_code_base64 || '',
      ticket_url: pixData?.ticket_url || '',
      valor: result.transaction_amount,
    });

  } catch (error) {
    console.error('Erro ao criar PIX:', error);
    res.status(500).json({
      erro: 'Falha ao gerar PIX. Verifique as credenciais e tente novamente.',
      detalhe: error.message,
    });
  }
});

// ====== ROTA 2: CONSULTAR STATUS DO PAGAMENTO ======
app.get('/api/payment/:id', async (req, res) => {
  try {
    const result = await payment.get({ id: req.params.id });
    res.json({
      status: result.status,
      status_detail: result.status_detail,
      payment_id: result.id,
      valor: result.transaction_amount,
    });
  } catch (error) {
    console.error('Erro ao consultar pagamento:', error);
    res.status(500).json({ erro: 'Falha ao consultar pagamento.' });
  }
});

// ====== ROTA 3: WEBHOOK ======
app.post('/api/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'payment' && data?.id) {
      const paymentId = data.id;
      const result = await payment.get({ id: paymentId });

      console.log(`🔔 Webhook recebido: Pagamento ${paymentId}`);
      console.log(`   Status: ${result.status} | Detalhe: ${result.status_detail}`);
      console.log(`   Valor: R$ ${result.transaction_amount}`);
      console.log(`   Referência: ${result.external_reference}`);

      if (result.status === 'approved') {
        console.log('✅ PAGAMENTO APROVADO! Liberando produto/saldo...');
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(200).send('OK');
  }
});

// ====== HEALTH CHECK ======
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ====== FALLBACK SPA ======
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`   Base URL: ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
});
