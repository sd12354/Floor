import { InfoPage } from './InfoPage';

const UPDATED = 'October 2026';

export function AboutPage() {
  return (
    <InfoPage title="About Floor" draft={false}>
      <p>Floor is an autonomous eBay dropshipping tool. It lists products from your supplier, keeps price and stock in sync, and buys from the supplier only after a buyer has paid — never fulfilling an order that would net less than the margin floor you set.</p>
      <h2>Why "Floor"</h2>
      <p>Every seller has a line below which a sale costs them money. Floor makes that line a hard rule: it will hold or cancel an order before it ships one below your floor, so a supplier price swing never turns a sale into a loss.</p>
      <h2>What it does</h2>
      <p>Prices listings with every eBay fee counted, re-checks the margin at the moment of sale, pushes tracking back to eBay, and keeps you in the loop only when a decision is genuinely yours. It works with wholesale suppliers; retail arbitrage is not supported, in line with eBay's dropshipping policy.</p>
      <h2>Contact</h2>
      <p>Questions or data requests: reach the account owner through the email on file for this store.</p>
    </InfoPage>
  );
}

export function PrivacyPage() {
  return (
    <InfoPage title="Privacy Policy" updated={UPDATED}>
      <p>This policy explains what Floor collects and why. Floor is a self-hosted tool run by the store owner; the store owner is the data controller.</p>
      <h2>What we collect</h2>
      <p>Account details you enter (email, store settings), the eBay and supplier data needed to list and fulfil orders, and buyer order details (name, shipping address) received from eBay to fulfil purchases. Floor does not sell personal data.</p>
      <h2>How it is used</h2>
      <p>Solely to operate the store: listing items, placing supplier orders, and sending tracking. Buyer addresses are shared with your supplier only to ship the specific order.</p>
      <h2>Retention and your rights</h2>
      <p>Data is kept as long as needed for orders and tax records. You may request access to, correction of, or deletion of your personal data — see the data deletion section or contact the store owner.</p>
      <h2>Third parties</h2>
      <p>Floor connects to eBay and your chosen supplier. Their handling of data is governed by their own policies.</p>
    </InfoPage>
  );
}

export function TermsPage() {
  return (
    <InfoPage title="Terms of Service" updated={UPDATED}>
      <p>By using this Floor instance you agree to these terms.</p>
      <h2>Use of the service</h2>
      <p>Floor automates eBay listing and order fulfilment. You are responsible for complying with eBay's policies, your supplier's terms, and applicable law, including accurate listings and timely fulfilment.</p>
      <h2>No warranty</h2>
      <p>Floor is provided "as is", without warranty of any kind. Pricing, margin and fulfilment automation may contain errors; review orders before relying on them.</p>
      <h2>Limitation of liability</h2>
      <p>To the maximum extent permitted by law, the operator is not liable for losses arising from use of the service, including lost profits or supplier or marketplace actions.</p>
    </InfoPage>
  );
}

export function RefundPage() {
  return (
    <InfoPage title="Refund Policy" updated={UPDATED}>
      <p>Refunds for items bought from this eBay store follow eBay's Money Back Guarantee and the policy shown on each listing.</p>
      <h2>Returns</h2>
      <p>Return windows and who pays return shipping are stated on the listing and in the store's eBay return policy. Contact the seller through eBay to start a return.</p>
      <h2>Cancellations</h2>
      <p>If Floor cannot fulfil an order above its margin floor, or the supplier is out of stock, the order is cancelled and the buyer is refunded in full through eBay before any money changes hands.</p>
    </InfoPage>
  );
}

export function CookiePage() {
  return (
    <InfoPage title="Cookie Policy" updated={UPDATED}>
      <p>Floor's seller dashboard uses only what it needs to work.</p>
      <h2>What we store</h2>
      <p>A sign-in token (to keep you logged in) and small preferences such as whether you have seen the intro. These are kept in your browser's local storage, not sold or shared.</p>
      <h2>No third-party tracking</h2>
      <p>Floor's dashboard does not use advertising or analytics cookies. If you later add analytics, update this page and add a consent banner before doing so.</p>
    </InfoPage>
  );
}
