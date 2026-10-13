---
title: Platform — Sophia Cluster 1.0
description: The equipment itself: one server in your own cloud account, installed by us, with standard interfaces and your data in open formats.
source: public/product-platform + cluster catalogue (public fields) (pulled; edit it there, not here)
---

[Catalogue](/catalog) › Platform

# Platform

The equipment itself: one server in your own cloud account, installed by us, with standard interfaces and your data in open formats.

- Installed in your AWS account, at your own address
- Hourly backups to your own storage, with a weekly restore test
- Connect your own AI tools over MCP, the open standard
- Export everything in open formats, any time

*Shipped · next release 1.0.1*

## Installation

| Item | What it is | Status |
| --- | --- | --- |
| Third-party licences in a customer install | The outside components bundled with Sophia (the graph database, editor, drawing canvas, AI agent toolkit, fonts, AI search model) carry licences that allow us to install them for a paying customer. There is one exception, and it must be removed or fixed first. *Every third-party licence in the install is listed and compatible, with 1.0.1.* | Shipped · set up at install |
| Self-hosted Cluster on the customer's own model key | A Cluster can run its AI on the customer's own OpenRouter account today by setting one secret. Running directly on the customer's Anthropic or Azure OpenAI account needs development work first. *Today we set your OpenRouter key during installation; 1.1 adds Anthropic and Azure OpenAI directly, and routing that only uses providers that don't train on or retain your text.* | Shipped · set up at install |
| One-server install in your AWS account | We set Sophia up on one server inside your company's own Amazon Web Services account, with its own web address, sign-in, storage and backups. The same package runs our hosted service today, but it has only ever been installed once, on our own server. | Shipped · set up at install |
| Your own web address and certificate | Sophia answers at an address like sophia.yourcompany.com, with a security certificate that renews itself. | Shipped · set up at install |
| Commercial licence for Sophia Cluster 1.0 | The document that lets a company use Sophia for business, forever, at the version it bought. *The Sophia Cluster 1.0 licence text, published with 1.0.1.* | Scheduled · 1.0.1 |
| Agent runtime on the same server | Sophia's assistant (the part that reads and writes workspaces for you) runs on a second server today. For your install we'd want it on the same server to keep cost and upkeep down. Nobody has built or tried that yet. *In 1.1 the agent runtime runs on the same server, so an install is one machine.* | Scheduled · 1.1 |
| Configuration with no Sophia account baked in | Today the setup files name our own Amazon account, our web addresses and our sign-in system in dozens of places. For your install, every one of those has to become your value, set in one place. *In 1.1 the installer carries no Sophia accounts or names; everything is yours.* | Scheduled · 1.1 |
| Delivering the private software to your server | The parts of Sophia that are not open source (gateway, web app, assistant) have to reach your account securely and be kept current. No delivery channel for that exists yet. *Signed, versioned release bundles you pull yourself, in 1.1.* | Scheduled · 1.1 |
| Install on Microsoft Azure | Running Sophia in your company's Microsoft Azure account instead of Amazon's. This is not available. The server setup would carry over, but Sophia's sign-in and permission records are built on Amazon services. *Planned after 1.2; tell us if you need it sooner.* | Backlog |
| Install on your own Linux server (on-premises) | Running Sophia on a server in your own building or data center. Not available today. The server part is portable; sign-in and permissions still depend on Amazon. *Planned after 1.2; tell us if you need it sooner.* | Backlog |

## Operations

| Item | What it is | Status |
| --- | --- | --- |
| Workspace engine (gardend): storage, durability and idle shutdown | Each workspace runs as its own small server that keeps documents, links and data on disk, saves them safely, and switches itself off when nobody is using it. | Shipped |
| Health report (vitals) | Every five minutes the server records its own health (memory, disk, backups, certificates, error rate), and one command grades it OK, WATCH or DEGRADED. | Shipped · set up at install |
| Hourly backups to your own storage | Every hour, each workspace that changed is copied off the server into a storage bucket in your account. Old copies are thinned on a schedule: hourly for a day, daily for two weeks, weekly for two months, monthly for a year. | Shipped · set up at install |
| Operating-system and platform patching | Security updates to the server's operating system install themselves. Bigger platform updates and reboots are done by us in an agreed maintenance window. | Shipped · set up at install |
| Server sizing and monthly running cost | How big a server you need for your number of people and workspaces, and roughly what Amazon will charge you each month to run it. | Shipped · set up at install |
| Alerts that reach a person | When the server is in trouble (disk full, a backup failed, a certificate about to expire), someone gets an email or a page. That does not happen today. *Alerts reach a person by email or text, with 1.0.1.* | Scheduled · 1.0.1 |
| Rebuild after losing the server (disaster recovery) | If the server is destroyed, how we bring Sophia back from the backups and how long that takes. This is not written down or practised. *A tested procedure to rebuild the server from its backups, in 1.1.* | Scheduled · 1.1 |
| Upgrades (how you get version 1.1) | When we release a new version, how it reaches your server, and how we roll back if it misbehaves. We can do this for our own server in one command; there is no way yet to deliver it to yours. *One-command upgrades between versions, starting with 1.1.* | Scheduled · 1.1 |

## Security & access

| Item | What it is | Status |
| --- | --- | --- |
| Sign-in (email and password) | People sign in with email and password through Amazon Cognito, and the server checks every sign-in token strictly. | Shipped |
| Encryption in transit and at rest | Traffic to the service is encrypted. The server's disks, its databases and its backups are encrypted where they are stored. | Shipped |
| Sharing a workspace (owner, editor, viewer, links) | Each workspace has one owner, who can invite people as editors or viewers or send a share link. A viewer can read but not change anything, and that holds for their AI chat too. | Shipped |
| Fresh secrets and keys for each install | Each install gets its own passwords and keys, generated fresh and never shared with another company. You decide who holds the master key. | Shipped · set up at install |
| Remote support access | With your permission, our engineers can open a secure session on your Sophia server to fix problems, without any open port on the internet, and you can switch that access off. | Shipped · set up at install |
| Read-only viewers in the browser | Let someone read a workspace without being able to change it, for example a customer or a new hire. *1.0.1 lets read-only colleagues open shared workspaces in the browser.* | Scheduled · 1.0.1 |
| Security questionnaire readiness | The paperwork a mid-size company's IT team or insurer asks for before buying: certifications, a penetration test, an incident plan, and how we find and fix vulnerabilities. *A security and data-handling sheet for your questionnaire, with 1.0.1.* | Scheduled · 1.0.1 |
| Audit trail | A record of who opened, changed, shared or deleted what, which an administrator can search and export. *An audit trail of who changed what, kept for a year, in 1.1.* | Scheduled · 1.1 |
| Company controls over AI use | An owner cannot yet choose which AI models staff may use, set a monthly AI budget per team, or see a report of who used how much AI and what the agents changed. *Approved models, budgets per person and team, and a usage report, in 1.1.* | Scheduled · 1.1 |
| Company sign-in and user administration (SSO, SCIM, groups, offboarding) | Staff sign in with the company's Google or Microsoft account, are added and removed automatically, and are given access by team. When someone leaves, their workspaces pass to a colleague. *Sign in with Microsoft Entra ID or Google Workspace, with an admin page for people and groups, in 1.1.* | Scheduled · 1.1 |

## Connections

| Item | What it is | Status |
| --- | --- | --- |
| Connect your own AI assistant (MCP with API keys) | Your staff can point an AI assistant they already use (Claude Desktop, Claude Code, Cursor, Copilot Studio or any tool that speaks MCP) at a Sophia workspace with a key, then read it, search it and write to it. | Shipped |
| Notes-app and Markdown import (Obsidian, Notion, Roam) | Bring an existing wiki or notes export into Sophia in one step; links between pages are kept as connections. | Shipped |
| Your agent loads your records (bring-your-own-agent import) | Instead of us building a connector, an AI agent that can already read one of your systems copies what matters into Sophia as tidy records (customers, items, orders) that Sophia checks against a schema before saving. | Shipped · set up at install |
| Searchable PDFs and Office files | Sophia reads the text inside PDFs, Word, Excel and PowerPoint files so people and agents can search and quote them. *1.0.1 turns on text extraction for PDF, Word and Excel uploads.* | Scheduled · 1.0.1 |
| Connectors for Claude.ai, ChatGPT and Claude Desktop (sign-in, no key) | Adding Sophia as a connector inside Claude.ai or ChatGPT, signing in with your Sophia account, does not work yet. The groundwork is partly built. *Connect ChatGPT, Claude.ai and Copilot to your workspace by signing in, without copying a key, in 1.1.* | In progress · 1.1 |
| Large imports without memory risk (bulk loader) | Loading years of orders or invoices in one go without the workspace running out of memory. *Load millions of records without memory risk, in 1.1.* | In progress · 1.1 |
| Connection manager (scheduled sync engine) | One place where an admin connects a system, sees when it last synced, what came in and what failed, and turns it off. *One place to connect your systems, schedule syncs and read their logs, in 1.2.* | Scheduled · 1.2 |
| Microsoft Dynamics 365 Business Central | Customers, vendors, items, prices, sales and purchase orders, invoices and stock levels from Business Central appear in Sophia and stay current. *A Business Central connector ships with 1.2.* | Scheduled · 1.2 |
| Microsoft Dynamics GP and other SQL Server databases | For companies still on Dynamics GP (or another system that keeps its data in SQL Server), a small read-only agent inside your network copies customers, items, orders and invoices into Sophia. *A read-only Dynamics GP and SQL Server connector that runs inside your network ships with 1.2.* | Scheduled · 1.2 |
| Shared drives: SharePoint, OneDrive and Google Drive | Price lists, spec sheets, SOPs and contracts in your shared drives are copied into Sophia, kept up to date, and searchable. *SharePoint, OneDrive and Google Drive, with their permissions carried over, in 1.2.* | Scheduled · 1.2 |
| Email and calendar (Outlook/Exchange, Gmail) | Selected mailboxes or shared inboxes (orders@, support@) are read so Sophia knows the history with each customer and vendor. *Planned after 1.2; tell us if you need it sooner.* | Backlog |
| Help desk (Zendesk, Freshdesk) | Support tickets and their resolutions come into Sophia, so answers to repeat questions are findable. *Planned after 1.2; tell us if you need it sooner.* | Backlog |
| NetSuite | Customers, items, orders and invoices from NetSuite appear in Sophia and stay current. *Planned after 1.2; tell us if you need it sooner.* | Backlog |
| Sage and Epicor ERPs | The same customer, item and order picture for companies on Sage or Epicor. *Planned after 1.2; tell us if you need it sooner.* | Backlog |
| Shopify | Online orders, products and customers from your Shopify store appear in Sophia next to the ERP picture. *Planned after 1.2; tell us if you need it sooner.* | Backlog |
| Team chat (Slack, Microsoft Teams) | Chosen channels from your team chat are kept in Sophia, and an agent can answer when someone mentions it there. *Slack and Teams, planned after 1.2; tell us if you need it sooner.* | Backlog |

## Developer surface

| Item | What it is | Status |
| --- | --- | --- |
| Published source code (gardend, Shrubbery, sophia-mcp) | The core engine and the web interface are published for anyone to read and run for non-commercial use. The connector that lets AI tools talk to Sophia is fully open source. | Shipped |
| Linked-data and SPARQL load | Your IT team or a consultant can load data that is already in a standard graph format, or change it with standard queries. | Shipped |
| sophia-mcp, the open-source connector program | A small free program (MIT licence) that connects desktop AI tools to Sophia. It works for a private local workspace and for our own operators; it does not yet work with the personal keys customers create. *1.0.1 makes the open-source connector work with your API key, on macOS, Linux and Windows.* | Shipped · set up at install |
