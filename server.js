import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import paypal from '@paypal/checkout-server-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString(); // needed for webhook verification
  }
}));

const PORT = process.env.PORT || 5000;

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

// Product schema
const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  stock: Number,
  description: String,
});

const Product = mongoose.model('Product', productSchema);

// PayPal SDK setup
const clientId = process.env.PAYPAL_CLIENT_ID || 'Acun5f4iWIgTUIYwNOJ_iktpTMIw8Q8ADsp8DUTQGJAkMtN_hHcCWMN46cVutLTRI0cs8SSnjQnEwGVW';
const clientSecret = process.env.PAYPAL_CLIENT_SECRET || 'EGRwhDCBQWist_CevyQqIzU_UuwLnTXSoDHHC4Cn3XsvTzkZaCB-uXV_v8jp4GUcwr2lPjECyb3No_t5';
const environment = new paypal.core.SandboxEnvironment(clientId, clientSecret);
const paypalClient = new paypal.core.PayPalHttpClient(environment);

// Replace with your actual webhook ID from PayPal dashboard
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || 'YOUR_PAYPAL_WEBHOOK_ID';

// --- Product API routes ---

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch(err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add a new product (admin)
app.post('/api/products', async (req, res) => {
  try {
    const { name, price, stock, description } = req.body;
    const newProduct = new Product({ name, price, stock, description });
    await newProduct.save();
    res.status(201).json(newProduct);
  } catch(err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update product by id (admin)
app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, price, stock, description } = req.body;
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { name, price, stock, description },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch(err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete product by id (admin)
app.delete('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch(err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// --- PayPal integration ---

// Create a PayPal order
app.post('/api/create-order', async (req, res) => {
  const { amount } = req.body;

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{
      amount: {
        currency_code: "GBP",
        value: amount
      }
    }]
  });

  try {
    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error('PayPal create order error:', err);
    res.status(500).json({ error: 'Failed to create PayPal order' });
  }
});

// PayPal webhook listener
app.post('/api/paypal/webhook', async (req, res) => {
  try {
    const verifyReq = new paypal.notifications.VerifyWebhookSignatureRequest();
    verifyReq.requestBody({
      auth_algo: req.headers['paypal-auth-algo'],
      cert_url: req.headers['paypal-cert-url'],
      transmission_id: req.headers['paypal-transmission-id'],
      transmission_sig: req.headers['paypal-transmission-sig'],
      transmission_time: req.headers['paypal-transmission-time'],
      webhook_id: WEBHOOK_ID,
      webhook_event: req.body,
    });

    const response = await paypalClient.execute(verifyReq);

    if (response.result.verification_status === 'SUCCESS') {
      const eventType = req.body.event_type;
      if (eventType === 'CHECKOUT.ORDER.APPROVED' || eventType === 'PAYMENT.CAPTURE.COMPLETED') {
        console.log('PayPal payment successful event:', req.body);

        // TODO: Update your database here (mark order paid, reduce stock, notify user, etc.)

        return res.sendStatus(200);
      } else {
        // Other events you might want to handle
        return res.sendStatus(200);
      }
    } else {
      console.warn('PayPal webhook verification failed');
      return res.status(400).send('Invalid webhook');
    }
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).send('Server error');
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
