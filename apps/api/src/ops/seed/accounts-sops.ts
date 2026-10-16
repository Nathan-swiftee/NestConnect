import type { OpsSopInput } from "@ding/schemas";

/**
 * The Accounts team's first two SOPs, as written by the business: Business
 * credit accounts, and Receivables. Added once to the operator's own workspace
 * by OpsSeedService — after that they're ordinary SOPs, edited in the app.
 *
 * Logins are deliberately not here: an SOP is read by a whole team, and a
 * password in one is a password handed to everyone who can open it. They say
 * where the login lives instead.
 */
export const ACCOUNTS_SOPS_SEED_KEY = "seed.ops.accounts-sops-v1";
export const ACCOUNTS_COLLECTION = { name: "Finance", icon: "💷", color: "#0FA47A" };
/** The SOPs' owner, when they're in the workspace. */
export const ACCOUNTS_SOPS_OWNER = { email: "david.miles@swiftee.co.uk", name: "David Miles" };

const LOGIN = "🔐 Login: in the team password manager — ask David if you don't have it.";

export const BUSINESS_CREDIT_ACCOUNTS: OpsSopInput = {
  title: "Business credit accounts",
  icon: "💳",
  summary:
    "How Swiftee Credit Accounts work and how to set one up: business customers book without paying upfront, get a statement on the 1st, and pay by Direct Debit on the 5th.",
  warnings: [
    "⚠️ If there is an issue with a statement, it must be raised before the 5th — otherwise payment is taken as scheduled.",
    "Always make sure the Direct Debit is active before allowing any credit usage.",
    "Never manually override a credit limit without approval.",
    "The email templates below are drafts — David to rewrite them before they're used.",
  ].join("\n"),
  steps: [
    {
      text: "Collect the account details. Business: Legal Entity Name, Registered Address, Company Email (the Accounts Payable email). Account holder: Full Name, Phone Number, Personal Email Address.",
    },
    { text: `Run a company credit check in CreditSafe. ${LOGIN}`, link: "https://www.creditsafe.com" },
    { text: "Assign a credit limit based on the CreditSafe score." },
    { text: "Record the approved credit limit in the system." },
    { text: `Send the customer the Direct Debit mandate link from GoCardless. ${LOGIN}`, link: "https://manage.gocardless.com" },
    { text: "Confirm the Direct Debit is active in GoCardless. No active DD, no credit." },
    { text: "Add the payment method in the system — Custom Field: Payment Method = Direct Debit." },
    { text: "Send the customer the “Credit Account Approved” welcome email (template below), with their credit limit, booking link and tracking link." },
  ],
  body: `
<h2>📌 What is a Swiftee Credit Account</h2>
<p>A Swiftee Credit Account allows business customers to place deliveries without paying upfront. Instead:</p>
<ul>
<li>📅 All activity is tracked monthly</li>
<li>🧾 A statement is issued on the <strong>1st of each month</strong> (covering the previous month)</li>
<li>💰 Payment is automatically collected on the <strong>5th of the month</strong> via Direct Debit (DD)</li>
</ul>
<p>⚠️ If there is an issue with the statement, it must be raised <strong>before the 5th</strong>, otherwise payment will be taken as scheduled.</p>

<h2>🚀 How to apply</h2>
<p>Customers apply via 👉 <a href="https://swiftee.co.uk/business">swiftee.co.uk/business</a></p>

<h2>🧾 Account setup requirements</h2>
<p>When creating a credit account, make sure the following details are collected:</p>
<h3>🏢 Business information</h3>
<ul>
<li>Legal Entity Name</li>
<li>Registered Address</li>
<li>Company Email (Accounts Payable email)</li>
</ul>
<h3>👤 Account holder details</h3>
<ul>
<li>Full Name</li>
<li>Phone Number</li>
<li>Personal Email Address</li>
</ul>

<h2>🔍 Credit checks &amp; limits</h2>
<p>We assess all accounts using 👉 <strong>CreditSafe</strong>.</p>
<p>${LOGIN}</p>
<p>Process:</p>
<ul>
<li>Run company credit check</li>
<li>Assign credit limit based on score</li>
<li>Record approved limit in system</li>
</ul>

<h2>💰 Payment setup (Direct Debit)</h2>
<p>All credit accounts must have an active DD, via 👉 <strong>GoCardless</strong>.</p>
<p>${LOGIN}</p>
<ol>
<li>Send DD mandate link to customer</li>
<li>Confirm DD is active</li>
<li>Add payment method in system — Custom Field: <code>Payment Method = Direct Debit</code></li>
</ol>

<h2>📊 Credit monitoring</h2>
<ul>
<li>Ongoing monitoring via CreditSafe</li>
<li>Review accounts periodically</li>
<li>Adjust limits if risk profile changes</li>
</ul>

<h2>📧 Email templates</h2>
<p><em>Drafts — David to rewrite these before use.</em></p>

<h3>🎉 Welcome – Credit Account Approved</h3>
<p><strong>Subject:</strong> Your Swiftee Credit Account is Live 🚚</p>
<blockquote>
<p>Your Swiftee credit account has been successfully set up ✅</p>
<p>You can now start booking deliveries without upfront payment.</p>
<p>We use credit check tools to determine credit limits. Your maximum limit is: [Insert Credit Limit]</p>
<p>🔗 Book here: [Insert Booking Link]<br>📊 Track deliveries: [Insert Tracking Link]</p>
<p>Your monthly statements will be issued on the 1st, with payment collected on the 5th via Direct Debit.</p>
<p>If you need anything, we’re here to help.</p>
<p>— Swiftee Team 🚚</p>
</blockquote>

<h3>📈 Credit Limit Updated</h3>
<p><strong>Subject:</strong> Update to Your Swiftee Credit Limit</p>
<blockquote>
<p>Hi {{Name}},</p>
<p>We’ve updated your credit limit on your Swiftee account.</p>
<p>This adjustment is based on automated credit monitoring and account activity.</p>
<p>If you have any questions, feel free to reach out.</p>
<p>— Swiftee Team 🚚</p>
</blockquote>

<h2>⚠️ Direct Debit cancelled</h2>
<p>If a DD is cancelled, 🚫 immediately:</p>
<ul>
<li>Pause the account</li>
<li>Stop all new bookings</li>
<li>Trigger the credit control process</li>
</ul>
<h3>📧 Account Paused email</h3>
<p><strong>Subject:</strong> Action Required – Account Paused</p>
<blockquote>
<p>Hi {{Name}},</p>
<p>Your Swiftee credit account has been temporarily paused due to an issue with your Direct Debit.</p>
<p>To restore your account, please set up a new DD below:</p>
<p>🔗 [Insert GoCardless Link]</p>
<p>Once completed, your account will be reactivated.</p>
<p>— Swiftee Team 🚚</p>
</blockquote>

<h2>🧹 Inactive accounts</h2>
<p>Accounts with no credit usage for <strong>6 months</strong> should be 👉 ❌ <strong>disabled in the system</strong>.</p>

<h2>🔄 Internal notes / best practice</h2>
<ul>
<li>Always ensure DD is active before allowing credit usage</li>
<li>Never manually override credit limits without approval</li>
<li>Keep account data clean and updated</li>
<li>Use system notes for any credit-related decisions</li>
</ul>
`.trim(),
  resources: [
    { kind: "link", title: "Apply for a business account — swiftee.co.uk/business", url: "https://swiftee.co.uk/business" },
    { kind: "link", title: "CreditSafe", url: "https://www.creditsafe.com" },
    { kind: "link", title: "GoCardless", url: "https://manage.gocardless.com" },
  ],
};

export const RECEIVABLES: OpsSopInput = {
  title: "Receivables",
  icon: "🧾",
  summary:
    "The monthly receivables cycle: invoices out on the 1st, Direct Debit and card charging, retries, reminders, calls and month-end escalation for non-payment.",
  warnings: [
    "Make any invoice changes before charging.",
    "Failed GoCardless Direct Debit: add the failed-DD fee to the customer's account when retrying.",
    "Respond to every customer inquiry within 48 hours.",
  ].join("\n"),
  steps: [
    {
      text: "1st — Automatic invoice distribution. Invoices go out to customers automatically. Monitor and respond to customer replies, and complete any invoice modifications before charging.",
    },
    {
      text: "2nd & 3rd — Customer inquiries. The Accounting team handles invoice and payment queries; the Operations team handles operational queries. Respond to every inquiry within 48 hours.",
    },
    {
      text: "4th — Direct Debit charging. Prepare a CSV from admin.swiftee.co.uk, then in GoCardless bulk create payments and upload the CSV to process the DD payments.",
      link: "https://manage.gocardless.com",
    },
    {
      text: "5th — Credit card charging (Stripe). Log into Stripe (Swiftee Accounts division). Use the import sheet from the Admin Portal, filtering invoices by Sent status. Charge the Outstanding amount for each account, then allocate it in the Admin Portal as Paid.",
      link: "https://dashboard.stripe.com",
    },
    {
      text: "6th, 7th & 8th — Card and DD retries. Create the Credit Control Sheet. Retry failed GoCardless payments — IMPORTANT: add the fee for the failed DD to the account. Retry failed Stripe payments daily.",
    },
    { text: "9th — Finalise DD allocations. Once the bulk DD charges are successful, allocate them in the Admin Portal.", link: "https://admin.swiftee.co.uk" },
    { text: "10th — First reminders. Email every customer with unpaid invoices." },
    { text: "15th — Second reminders. Email the customers still unpaid, and respond promptly to any replies." },
    { text: "17th — Meeting with Sol. Review all outstanding accounts and get advice or support on problem accounts." },
    { text: "20th — First round of calls. Phone customers with unpaid invoices, politely requesting payment." },
    { text: "24th — Second round of calls. Follow up by phone with customers still unpaid." },
    { text: "27th — Third round of calls. Final calls to persistent non-paying customers." },
    { text: "28th — End of month. Prepare blocking/suspension actions for customers who still haven't paid." },
  ],
  body: `
<p>👤 <strong>Owner:</strong> David Miles<br>🏢 <strong>Department:</strong> Finance<br>📋 <strong>Software used:</strong> GoCardless, Stripe, admin.swiftee.co.uk</p>

<h2>🧭 Objective</h2>
<p>To ensure timely, accurate, and systematic management of all accounts receivable functions, including invoice distribution, payment collection, customer follow-ups, and escalation for non-payment.</p>

<h2>📌 Scope</h2>
<p>This SOP applies to all activities related to invoice distribution, customer inquiries, payment collection via Direct Debit and Credit Card, payment retries, and customer follow-ups.</p>

<h2>⚠️ Escalation flow</h2>
<ol>
<li><strong>Reminder 1</strong> — invoice is unpaid after the 1st notice → send follow-up reminder</li>
<li><strong>Reminder 2</strong> — invoice is still unpaid → email + escalate internally</li>
<li><strong>Call 1</strong> — no payment after the second reminder → first call</li>
<li><strong>Call 2</strong> — still no payment → second follow-up call</li>
<li><strong>Call 3</strong> — still unpaid → final call before action</li>
<li><strong>Month-end</strong> — still unpaid after 3 call attempts → escalate for blocking/suspension</li>
</ol>

<h2>🧰 Tools used</h2>
<ul>
<li><strong>GoCardless</strong> — Direct Debit collection</li>
<li><strong>Stripe</strong> — credit card charging</li>
<li><strong>admin.swiftee.co.uk</strong> — invoice management, allocation</li>
<li><strong>Business Ops</strong> — SOP documentation</li>
<li><strong>Email</strong> — customer reminders and communications</li>
</ul>

<h2>📚 Best practices</h2>
<ul>
<li>✅ Respond to inquiries <strong>within 48 hours</strong></li>
<li>✅ Modify invoice details <strong>before charging</strong></li>
<li>✅ Retry failed payments <strong>daily, and add the GC fee for a failed DD to the account</strong></li>
<li>✅ Always document all customer communications</li>
<li>✅ Keep a calm, polite tone during phone reminders</li>
</ul>
`.trim(),
  resources: [
    { kind: "link", title: "GoCardless", url: "https://manage.gocardless.com" },
    { kind: "link", title: "Stripe", url: "https://dashboard.stripe.com" },
    { kind: "link", title: "Swiftee Admin Portal", url: "https://admin.swiftee.co.uk" },
  ],
};

export const ACCOUNTS_SOPS: OpsSopInput[] = [BUSINESS_CREDIT_ACCOUNTS, RECEIVABLES];
