# Online payments

Customers can pay when they book, with Mercado Pago. The money goes straight from the customer
to the business's own account: OpenTurnly only starts the charge and reads how it ended. It
never holds money, and card details are typed on Mercado Pago's page.

Mercado Pago's documentation lists Checkout Pro in Argentina, Brazil, Chile, Colombia, Mexico,
Peru and Uruguay. So far it has only been tried in Colombia.

## Connect a business

Each business connects its own account, so every business needs its own Access Token:

1. In [Mercado Pago Developers](https://www.mercadopago.com/developers), create an application
   with the business's account.
2. Open **Production credentials** and activate them: the business's industry, its website and
   the terms.
3. Copy the **Access Token**. The Public Key and the Client Secret aren't needed.
4. In OpenTurnly, paste it in **Settings → Payments** and choose **Connect**.

The business's currency has to be the one of the Mercado Pago account's country, or the
connection is refused. The token is stored encrypted with the install's `SECRET` and never
comes back to the browser. If you renew it in Mercado Pago, or change `SECRET`, paste it again.

## Choose what's charged

In **Services**, each service has an **Online payment** setting:

- **No charge**: booking works as always.
- **Optional**: the customer chooses between paying now and paying at the business.
- **Deposit**: the customer pays the amount you set and the rest at the business.
- **Full payment**: the customer pays the whole price.

## What happens when someone books

1. The time is held for 15 minutes, and the appointment shows in the agenda waiting for payment.
2. The customer pays on Mercado Pago's page and comes back to the booking page.
3. Once it's paid, the appointment is confirmed, the money is a deposit of that appointment,
   and workflows hear about the booking. They don't before.
4. If nobody pays, the appointment is cancelled and the time is free again.

What counts is the order's state at Mercado Pago, which OpenTurnly reads when the customer
comes back and every minute until it's settled.

A customer has one unpaid booking at a time. Booking the same thing again picks up the payment
they left open, booking anything else replaces it, and the page they come back to can cancel it.

## Payments that arrive late

Some methods take a while, so a payment can finish after its time was released. Released orders
are watched for 24 hours:

- If the time is still free, the appointment is confirmed.
- If someone else took it, it has passed, or the customer gave that booking up, the money goes
  back to the customer on its own. It shows under **Refunds** in **Settings → Payments**.

Refunds come out of the business's Mercado Pago account, which needs the balance. When Mercado
Pago refuses one it stays **Pending** there and is tried again every hour. Mercado Pago allows
refunds for 180 days after a payment, and how long the money takes to reach the customer depends
on their bank.

## Instant confirmation

Notifications are optional. Without them a payment is confirmed when the customer comes back, or
within a couple of minutes if they don't. To have Mercado Pago tell OpenTurnly right away, copy
the URL shown in **Settings → Payments** into your application's **Webhooks**, with the **Order**
event. It has to be a public address.

A notification only makes OpenTurnly read the order again, so nothing depends on trusting it.

## What it doesn't do yet

- **AI agents don't charge.** An appointment booked through [MCP](mcp.md) is confirmed without
  payment, even if the service asks for one. So are the ones the business adds in the panel.
- **Other refunds are by hand.** To give money back for an appointment that was cancelled after
  it was paid, refund it in Mercado Pago. OpenTurnly doesn't record it.

## Try it without real money

1. In your application, open the **Test** credentials and paste that Access Token. The business
   shows **Test account**.
2. In **Test accounts**, create a **Buyer** account in the same country. The test seller already
   exists.
3. Book in an incognito window. On Mercado Pago's page choose to sign in with an account, and
   use the buyer's user and password. If it asks for a code, it's in the same account's details.
4. Pay with the test card shown in your application, with `APRO` as the holder's name for an
   approved payment or `OTHE` for a rejected one.

Paying as a guest or with a real account doesn't work against a test seller: the page answers
"No pudimos procesar tu pago" or "Una de las partes con la que intentas hacer el pago es de
prueba", and the order stays unpaid.
