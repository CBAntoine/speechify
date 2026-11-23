/**
 * The thirteen workflows from the Cyber Security Engineer design, as the
 * voice agent and the console describe them. Two run today; the rest list
 * what they need before they can be connected.
 */

export type WorkflowStatus = "available" | "drafts" | "designed";

export interface Workflow {
  code: string;
  name: string;
  area: string;
  status: WorkflowStatus;
  trigger: string;
  summary: string;
  steps: string[];
  needs: string;
  guardrail: string;
}

export const WORKFLOWS: Workflow[] = [
  {
    code: "NET-1",
    name: "Firewall change requests",
    area: "Network",
    status: "drafts",
    trigger: "Someone asks for access through the firewall",
    summary: "Turns an access request into FortiOS commands: objects to reuse or create, where the policy goes, risk, test plan and rollback, checked against the loaded backup.",
    steps: [
      "Collects source, destination, service, business owner and an end date for temporary access",
      "Looks for existing objects and rules that already cover the flow or would shadow the new rule",
      "Checks the request against zone policy: no IT-to-OT paths, nothing inbound except through the DMZ, no ALL service, logging on",
      "Drafts the policy with security profiles, its placement, a test plan and a rollback",
      "A firewall engineer reviews it and the change board approves; an engineer installs it",
    ],
    needs: "Works now as drafts against a loaded backup. Submitting drafts for approval needs a FortiManager API admin that can open workflow sessions.",
    guardrail: "Drafts only. Claude can't approve or install a change.",
  },
  {
    code: "NET-2",
    name: "Rulebase and firmware review",
    area: "Network",
    status: "available",
    trigger: "Monthly, or on request with a backup",
    summary: "Reviews a FortiGate backup with 25 checks and writes a report with the config lines behind each finding and fixes grouped into change requests.",
    steps: [
      "Removes secrets from the backup in the browser, before anything is uploaded",
      "Checks rules (any-any, shadowed, unused, logging, exposure), admin access, VPN crypto and firmware",
      "Quotes the config lines behind each finding",
      "Drafts fixes as FortiOS commands, disabling rules before deleting them",
      "A separate grader checks the report against a 10-point rubric before it's done",
    ],
    needs: "Available now. Monthly runs without exports need a worker inside the network that pulls backups from FortiManager.",
    guardrail: "Read-only. It changes nothing on the firewall.",
  },
  {
    code: "NET-3",
    name: "Network troubleshooting",
    area: "Network",
    status: "designed",
    trigger: "An incident names a flow that fails",
    summary: "Runs read-only diagnostics on the firewall, reads the logs for the flow and ranks the likely causes.",
    steps: [
      "Restates the failing flow as source, destination, port and time",
      "Runs routing, session and policy lookups and a filtered debug flow",
      "Reads FortiAnalyzer logs for the flow",
      "Ranks causes by evidence and names the next test",
    ],
    needs: "Read-only CLI access to the FortiGates (allowlisted get, show and diagnose commands) and FortiAnalyzer logs.",
    guardrail: "Debug commands always carry a filter and a packet limit.",
  },
  {
    code: "EXP-1",
    name: "Vulnerability intake and ranking",
    area: "Exposure",
    status: "designed",
    trigger: "A scan finishes, or CISA, a vendor or the Cyber Centre publishes an advisory",
    summary: "Ranks findings by exploitation, exposure and asset criticality, and opens one ticket per owner and fix.",
    steps: [
      "Maps each finding to an asset and owner",
      "Adds known-exploited status, EPSS, internet exposure and compensating controls",
      "Ranks with an SSVC decision tree",
      "Opens tickets with the exact fix and due date; risk owners approve exceptions",
    ],
    needs: "A vulnerability scanner API (Tenable, Qualys, Rapid7 or Defender), CMDB owners and a ticketing system.",
    guardrail: "Never schedules scans of OT ranges.",
  },
  {
    code: "END-1",
    name: "EDR coverage and tuning",
    area: "Endpoint and email",
    status: "designed",
    trigger: "Every weekday, and when the SOC escalates an alert",
    summary: "Finds devices without a healthy sensor, checks policy drift and drafts the narrowest exclusions for false positives.",
    steps: [
      "Compares the device inventory with devices reporting to the EDR",
      "Checks tamper protection, attack surface reduction rules and wide exclusions",
      "Drafts narrow exclusions for repeat false positives",
      "The endpoint owner approves policy changes",
    ],
    needs: "Read access to Defender for Endpoint, Intune and Entra ID, and the SOC queue.",
    guardrail: "Drafts exclusions; never applies one.",
  },
  {
    code: "EML-1",
    name: "Phishing reports and email security",
    area: "Endpoint and email",
    status: "designed",
    trigger: "A user reports a message, and DMARC reports each Monday",
    summary: "Triages reported mail, finds every copy in the tenant and drafts the response for an analyst to approve.",
    steps: [
      "Reads the headers and authentication results",
      "Gets sandbox verdicts for links and attachments",
      "Finds other copies and classifies the message",
      "An analyst approves the purge and blocks",
    ],
    needs: "The report-button mailbox or Defender for Office 365 API, sandbox verdicts and DMARC aggregate reports.",
    guardrail: "The agent that reads attacker-written mail has no tools that change mail.",
  },
  {
    code: "IAM-1",
    name: "Privileged access",
    area: "Identity and keys",
    status: "designed",
    trigger: "Weekly discovery and the quarterly review",
    summary: "Finds every privileged account, reconciles it with the PAM vault and prepares managers' attestations.",
    steps: [
      "Finds admin accounts across Entra ID, Active Directory, servers, cloud and firewalls",
      "Flags unvaulted accounts, passwords that don't rotate and sessions that aren't recorded",
      "Flags standing admin rights that could be just-in-time",
      "Managers attest; the PAM administrator makes the changes",
    ],
    needs: "A PAM reporting role, Entra ID roles and PIM, and Active Directory group membership.",
    guardrail: "Sees account metadata only; can't retrieve a password.",
  },
  {
    code: "KEY-1",
    name: "Certificates and keys",
    area: "Identity and keys",
    status: "designed",
    trigger: "Every weekday",
    summary: "Inventories certificates and keys, flags what expires soon or is weak, and renews through ACME where it's pre-approved.",
    steps: [
      "Inventories certificates in Key Vault, the internal CA, firewalls and load balancers",
      "Flags certificates expiring within 30, 14 and 7 days, and weak keys",
      "Renews through ACME or Key Vault auto-rotation as a standard change",
      "Opens tickets for the rest",
    ],
    needs: "Key Vault Reader, the internal CA inventory and certificate lists from the firewalls and load balancers.",
    guardrail: "Metadata only; never reads key material.",
  },
  {
    code: "CFG-1",
    name: "Secure configuration baselines",
    area: "Cloud and config",
    status: "designed",
    trigger: "Every Monday, and when a new server image is built",
    summary: "Compares servers, Microsoft 365, Azure and firewalls with the agreed baseline and writes fixes as code in a pull request.",
    steps: [
      "Compares each platform with the CIS-based baseline and accepted deviations",
      "Explains each drift and why it matters",
      "Writes the fix as code in a pull request",
      "The platform owner reviews and merges",
    ],
    needs: "Azure Policy and Defender for Cloud read access, Intune or Group Policy exports, and a Git repository for fixes.",
    guardrail: "Nothing changes until a person merges the pull request.",
  },
  {
    code: "DEV-1",
    name: "IaC and pipeline review",
    area: "Cloud and config",
    status: "designed",
    trigger: "A pull request changes Terraform, Bicep or pipeline files",
    summary: "Reviews infrastructure-as-code changes for what scanners miss and comments with corrected code.",
    steps: [
      "Runs Checkov, Trivy, PSRule and gitleaks",
      "Looks for wide network rules, public access, keys instead of managed identities",
      "Comments on the exact lines with fixes",
      "A reviewer approves the merge",
    ],
    needs: "A pull request pipeline (GitHub Actions or Azure DevOps) running Claude Code and the scanners.",
    guardrail: "Can comment and suggest; can't approve or merge.",
  },
  {
    code: "OT-1",
    name: "OT and ICS security",
    area: "OT and ICS",
    status: "designed",
    trigger: "An ICS advisory, an OT monitoring alert or a vendor access request",
    summary: "Matches ICS advisories to plant devices and proposes compensating controls; plant engineering decides everything.",
    steps: [
      "Matches advisories to devices by vendor, model and firmware",
      "Proposes compensating controls when patching waits for a shutdown",
      "Checks vendor remote-access requests",
      "Plant and OT engineering decide and schedule every action",
    ],
    needs: "A passive OT monitoring API (Claroty, Nozomi or Dragos) and the CISA ICS advisory feed.",
    guardrail: "Passive only. Never scans the plant network or writes to a device.",
  },
  {
    code: "ARC-1",
    name: "Security architecture review",
    area: "Architecture and docs",
    status: "designed",
    trigger: "A new project, SaaS vendor or major change asks for review",
    summary: "Builds a threat model, maps required controls to NIST, ISO and CIS, and drafts the review for sign-off.",
    steps: [
      "Draws the data flows and trust boundaries",
      "Builds a STRIDE threat model",
      "Maps controls to NIST CSF 2.0, ISO 27001 and CIS Controls",
      "The security lead signs off; the risk owner accepts what remains",
    ],
    needs: "The design document and diagrams, and the vendor's SOC 2 report.",
    guardrail: "Drafts the review; sign-off belongs to people.",
  },
  {
    code: "DOC-1",
    name: "Runbooks, diagrams and audit evidence",
    area: "Architecture and docs",
    status: "designed",
    trigger: "A change closes, and the 1st of each month",
    summary: "Keeps runbooks and diagrams in step with the config and files audit evidence by control.",
    steps: [
      "Updates runbooks from closed change records",
      "Regenerates diagrams from live config",
      "Flags pages that no longer match the config",
      "The owner reviews and merges the docs pull request",
    ],
    needs: "The docs repository and the change records.",
    guardrail: "Every edit has a reviewer and an undo.",
  },
];

export function findWorkflow(query: string): Workflow | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    WORKFLOWS.find((w) => w.code.toLowerCase() === q) ??
    WORKFLOWS.find((w) => w.name.toLowerCase().includes(q) || q.includes(w.code.toLowerCase())) ??
    WORKFLOWS.find((w) => q.split(/\s+/).some((word) => word.length > 3 && `${w.name} ${w.area} ${w.summary}`.toLowerCase().includes(word)))
  );
}
