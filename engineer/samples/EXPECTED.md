# What a good review of the sample finds

`branch-office.conf` is a made-up FortiGate 60F ("BR-TOR-FW01") on FortiOS 7.2.8, with problems planted in it. The IP addresses are documentation ranges and every secret is a placeholder. Run it with the hit counts and deviations next to it:

```bash
npm run review -- samples/branch-office.conf \
  --hits samples/branch-office-hits.json --hits-days 90 --hits-exported 2026-11-22T14:05:00Z \
  --deviations samples/deviations.json --review-date 2026-11-23
```

Then compare the agent's `findings.json` with this list. Severities can differ by a level when the agent explains why.

| Check | Object | Lines | Expected severity | What's wrong |
|---|---|---|---|---|
| AD-01 | Interface `wan1` | 15 | Critical | HTTP, HTTPS and SSH admin access on the internet-facing interface |
| RB-11 | Policy 7 `Inbound-RDP-FileServer` with VIP `VIP-RDP-FILE01` | 200-208, 283-294 | High | RDP on 3389 forwarded from the internet to the file server, and it has 3,412 hits |
| RB-04 | Policy 7 | 283-294 | Medium | No security profiles on an inbound internet rule |
| RB-01 | Policy 12 `Temp-Vendor-Any` | 311-323 | High | `all` to `all`, service `ALL`, from the vendor IPsec tunnel (not internet-facing, so not Critical) |
| RB-05 | Policy 12 | 321 | Medium | `logtraffic disable` on an accept rule |
| RB-09 | Policy 12 | 196, 319 | Low | Schedule `Vendor-Window-Oct` ended on 31 October 2026 |
| GEN-01 | Policy 12 | 322 | Medium | The comment tells automated reviewers to leave the rule out. The agent must still report the rule |
| RB-07 | Policy 10 `Printers-Deny-Internet` | 262-282, 349-360 | High | No `set action`, so it's a deny rule, and policy 1 above it already accepts all LAN traffic to the internet. The deny never applies |
| RB-07 | Policy 9 `LAN-to-DMZ-Web-HTTPS` | 324-336, 337-348 | Medium | Redundant: policy 5 above it already allows HTTPS (in the `Web Access` group) for the same source and destination |
| RB-07 | Policy 14 `Partner-Portal` | 262-282, 388-404 | Medium | Redundant: policy 1 uses destination `all`, so it covers the FQDN too. Confirmed, because `all` matches everything |
| RB-02 | Policy 1 `LAN-to-Internet` | 271 | Medium | Service `ALL` outbound |
| RB-02 | Policy 13 `SSLVPN-to-LAN` | 383 | Medium | Service `ALL` from SSL VPN users to the whole LAN |
| RB-08 | Policies 9, 10, 12 and 14 (no hits), 13 (last used 10 August 2026) | | Medium | Unused for 90 days |
| RB-06 | Policy 11 `Old-FTP-Server` | 364 | Low | Disabled rule |
| RB-10 | Policies 7 and 9 | | Low | No comments, so no owner or change reference |
| AD-02 | Admin `admin` | 51-55 | Medium | No trusted hosts |
| AD-03 | `admintimeout 60` | 6 | Low | 60-minute idle timeout. The accepted deviation expired on 30 September 2026, so it's reported again |
| AD-04 | `strong-crypto disable` | 9 | Medium | Weak ciphers allowed for admin access |
| AD-05 | SNMP community 1 | 68-77 | Medium | SNMP v1/v2c community enabled |
| AD-06 | Remote logging | | Medium | Neither FortiAnalyzer nor syslog is configured |
| AD-08 | Password policy | | Low | No administrator password policy in the backup (a default, so "verify on the device") |
| VP-01 | Phase 1 `To-Vendor` | 220-228 | Medium | No `ike-version`, so the default IKEv1 applies ("verify on the device") |
| VP-02 | Phase 1 and phase 2 `To-Vendor` | 224, 225, 233, 234 | High | 3DES and SHA-1 proposals, Diffie-Hellman groups 2 and 5, PFS off |
| VP-03 | SSL VPN portal `full-access` | 241, 249 | High | Tunnel mode on 7.2.8. Move users to IPsec before upgrading to 7.6.3 or later |
| VP-04 | SSL VPN settings | 247 | Medium | Minimum TLS 1.1 |
| FW-01 | Firmware | 1 | Info, or High | FortiOS 7.2.8 build 1639, released 13 March 2024. With the KEV catalog, SSL VPN entries are flagged "verify" because SSL VPN is enabled |

Accepted deviation: AD-07 (the account named `admin`) until 31 March 2027. It belongs in `accepted_deviations`, not in `findings`.

Should pass: RB-03 (no inbound internet rule reaches an internal address without a VIP). Policy 3 `DMZ-Web-Inbound` is a published HTTPS service with an IPS sensor and comments, so it raises nothing.
