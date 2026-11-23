/**
 * What "done" means for one review. The session starts with a
 * user.define_outcome event: a separate grader scores each draft against this
 * rubric and the agent revises until it passes (up to MAX_ITERATIONS).
 *
 * This is a starter rubric. Tune it as you learn what your engineers need.
 */

export const MAX_ITERATIONS = 3;

export const CHECK_IDS = [
  "RB-01", "RB-02", "RB-03", "RB-04", "RB-05", "RB-06", "RB-07", "RB-08", "RB-09", "RB-10", "RB-11",
  "AD-01", "AD-02", "AD-03", "AD-04", "AD-05", "AD-06", "AD-07", "AD-08",
  "VP-01", "VP-02", "VP-03", "VP-04",
  "FW-01", "GEN-01",
];

export const RUBRIC = `# FortiGate rulebase review rubric (starter)

1. \`/mnt/session/outputs/report.md\`, \`/mnt/session/outputs/findings.json\` and \`/mnt/session/outputs/analysis.py\` all exist and are not empty.
2. \`findings.json\` parses as JSON with the keys \`device\`, \`review_date\`, \`inputs\`, \`summary\`, \`findings\`, \`passed_checks\`, \`skipped_checks\` and \`accepted_deviations\`, and each count in \`summary\` equals the number of findings with that severity.
3. Every check ID (${CHECK_IDS.join(", ")}) appears in at least one finding, in \`passed_checks\`, or in \`skipped_checks\` with a reason.
4. Every finding about something in the backup lists at least one line number, and each listed line in \`/mnt/session/uploads/config.conf\` sits inside the policy or object the finding names. A finding about something missing from the backup says what is missing and may list no lines.
5. Each critical or high finding names the exposure behind its rating: the internet-facing interface, the VIP, or the earlier rule that stops a later deny rule from applying.
6. Every proposed change is a FortiOS CLI block that starts with \`config\` and ends with \`end\`. No proposed change deletes a firewall policy; rules are disabled with \`set status disable\` instead.
7. No finding states that a CVE affects, or does not affect, this firmware unless an input file shows it. The others say to verify against the vendor advisory.
8. No output contains a value guessed or rebuilt in place of \`<redacted>\`, and no proposed change contains a password, key or community string.
9. Each shadowed or redundant rule finding names the earlier rule that covers it, and any overlap that depends on an object that couldn't be resolved is marked \`unconfirmed\`.
10. \`report.md\` opens with a summary paragraph giving counts by severity and the five most important actions, and it includes draft change requests with a test plan and a rollback for each.
`;

export interface RunInfo {
  device: string;
  reviewDate: string;
  files: string[];
}

export function outcomeDescription(run: RunInfo): string {
  return (
    `Do the monthly rulebase and firmware review of the FortiGate "${run.device}" as of ${run.reviewDate}, ` +
    `following your instructions. Write report.md, findings.json and analysis.py to /mnt/session/outputs/. ` +
    `Inputs in /mnt/session/uploads/: ${run.files.join(", ")}.`
  );
}
