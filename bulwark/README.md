# Bulwark

Bulwark finds the security holes in your devices and fixes them.

1. **This device.** It checks the computer it runs on: waiting security updates, the firewall, SSH settings, accounts with no password or a factory password, passwordless sudo, file permissions, kernel hardening, risky services like Telnet or an open Redis, disk encryption and Wi-Fi encryption. Linux, macOS and Windows each get their own checks.
2. **Your network.** If you ask it to, it finds the other devices on your network (router, cameras, printers, TVs, NAS boxes, phones) and checks each one's open services: Telnet, unencrypted logins, old firmware with known CVEs, SMBv1, Remote Desktop without NLA, VNC, databases and APIs with no password, and the port forwards your router opened by itself through UPnP.
3. **Fixes.** Most problems on this device, and the router's UPnP port forwards, have an automatic fix. Before anything changes, Bulwark shows you exactly what it will do: every file diff and every command. It checks that the fix can't lock you out, applies it, checks again that the problem is gone, and keeps a record so you can undo it later. Problems it can't fix itself (a camera's Telnet, a router's admin page) come with step-by-step instructions.

It has a dashboard in your browser and a command line, and no dependencies: just Node.js.

## Run it

You need [Node.js](https://nodejs.org) 22.6 or newer. There's nothing to install.

```bash
cd bulwark
./bulwark scan                 # check this device (about 10 seconds)
./bulwark scan --network       # …and every device on your network (about a minute)
./bulwark serve --sudo         # the dashboard: open the link it prints
```

On Windows, use `bulwark.cmd` instead of `./bulwark`, from a terminal opened with "Run as administrator".

Most fixes change system settings, so they need admin rights. Add `--sudo` (it re-runs the command with sudo and finds Node even when sudo's PATH doesn't) or run the commands with `sudo`. Without admin rights Bulwark still scans, and says which checks it had to skip.

**Try it on a pretend network first:** `npm run demo` starts eight fake devices on this computer's loopback addresses (a router with UPnP forwards, a camera with an open Telnet shell, a NAS with SMBv1 and an open Redis, an Android TV box with open debugging and more), scans them and opens the dashboard on port 7078. The fixes there are real, against the pretend router.

## Command line

| Command | What it does |
| --- | --- |
| `bulwark scan` | Check this device. Add `--network` for your network, or `--target 192.168.1.0/24` (repeatable) for specific addresses |
| `bulwark fix 3` | Show the plan for problem 3 from the last scan, then apply it if you say yes. Several numbers at once work too |
| `bulwark fix --all-safe` | Apply every low-risk fix (file permissions, kernel settings, SSH root login, macOS and Windows switches) |
| `bulwark fix 3 --dry-run` | Show the plan only |
| `bulwark rollback <id>` / `--last` | Undo a change |
| `bulwark history` | Every change Bulwark has made, with its result |
| `bulwark report` | The last scan as Markdown (`--format json` for JSON) |
| `bulwark checks` | Everything Bulwark checks for |
| `bulwark serve` | The dashboard on http://127.0.0.1:7077 (`--port` to change it) |

## What it checks and fixes

| Area | Checks | Automatic fix |
| --- | --- | --- |
| Updates | Waiting security updates (apt, dnf), automatic updates, restart needed; macOS update settings and pending updates; Windows update age | Install the security updates (can't be undone); set up unattended-upgrades; turn on macOS automatic security responses |
| Firewall | ufw, firewalld, nftables/iptables; macOS firewall and stealth mode; Windows Firewall profiles | Turn on ufw (allowing SSH first so you can't lock yourself out) or firewalld; macOS and Windows firewalls |
| SSH | Root login with a password, password logins, empty passwords. Reads sshd's real configuration, including Include files and Match blocks | Writes a drop-in that sshd reads first, comments out settings that would override it, tests with `sshd -t`, then reloads. Turning off passwords is refused if no account has an SSH key |
| Accounts | Empty passwords, factory passwords (pi/raspberry and friends, compared locally against the hashes), extra root accounts, passwordless sudo | Lock the account; require a new password at next login; make sudo ask for a password (refused if the user has no password, checked with `visudo -c`) |
| Files | Permissions on /etc/shadow, /etc/passwd, sudoers, crontab, SSH host keys; world-writable files in /etc and system program folders | Tighten the permissions (the fix can only ever remove permissions) |
| Kernel | ASLR, symlink and hardlink protection, kernel pointer and log restrictions, ptrace, unprivileged BPF, ICMP redirects, source routing, SYN cookies | Writes /etc/sysctl.d/99-zz-bulwark.conf and applies the values now |
| Services | Telnet, rsh, FTP, TFTP, X11, open Docker API, ADB, Redis, Memcached, MongoDB, Elasticsearch, databases, VNC, RDP, NFS, SNMP listening on the network; cups-browsed (CVE-2024-47176); SMBv1, RDP without NLA, Defender, UAC, Guest on Windows | Turn off the service (never SSH or anything the system needs); make Redis listen on localhost only; block the port in ufw; Windows switches |
| Encryption | LUKS/dm-crypt and ZFS, FileVault, BitLocker | Instructions (encrypting a disk in use isn't safe to automate) |
| Wi-Fi | Open, WEP, WPA1/TKIP networks | Instructions for the router |
| Network devices | Telnet (and Telnet that drops into a shell with no password), FTP, SSH versions, Terrapin (CVE-2023-48795) and weak SSH crypto, web logins over plain HTTP, TLS 1.0/1.1, expired certificates, open folder listings, SMBv1, RDP without NLA, VNC without a password, open Redis, Memcached, MongoDB, Elasticsearch, CouchDB and Docker APIs, anonymous MQTT, open Android debugging, exposed databases, camera streams with no login, Xiongmai/Dahua control ports, and known-vulnerable versions (regreSSHion, old Dropbear, vsftpd 2.3.4, Apache 2.4.49/50, Heartbleed-era OpenSSL, Boa, RomPager, MiniUPnPd, RediShell, MongoBleed, end-of-life Ubuntu and Debian) | Remove the router's UPnP port forwards (undo puts them back). Everything else comes with instructions for that device |

## How it keeps you safe

- **It only scans what's yours.** Without targets it scans the private network this computer is on, cut down to its /24, and asks you to confirm it's your network the first time. Public internet addresses (carrier-grade NAT ones included, since they belong to your ISP's other customers) need an explicit "I own these or have permission" (`--authorized`) and are capped at 256. Multicast and reserved addresses are never scanned, and no scan goes over 4,096 addresses.
- **It never logs in or tries passwords on other devices.** Network checks only ask a service what it accepts (which SMB versions, which VNC login methods, whether MQTT or Redis want a password) and read what it announces. The factory-password check only compares this computer's own password hashes, locally, with Perl's `crypt()`, through stdin.
- **Every fix is a plan first.** You see each file diff and command before anything changes. Fixes that could lock you out or disrupt something are marked "needs care" and are never part of "fix all".
- **Every fix is checked and can be undone.** Bulwark checks preconditions, applies the change, validates it (for example `sshd -t` before reloading SSH), re-runs the check, and undoes everything automatically if a step fails. Backups of every file it touches go into a journal, so `bulwark rollback` puts back files, permissions, services and router forwards exactly as they were. It refuses to undo over a file you've edited since.
- **Fixes use what's true now.** Before planning or applying a fix, Bulwark re-runs the check on the live system and takes the fix's details from that, not from a saved scan.
- **The dashboard is locked down.** It listens on 127.0.0.1 only, needs a random key on every request (it's in the link Bulwark prints), refuses unexpected Host headers (DNS rebinding), sends no CORS headers, accepts only JSON, and serves a strict Content-Security-Policy. A request can only say *which* finding to fix, never what the fix does. Everything shown from the network (device names, banners, page titles) is escaped.
- **Its own files are private.** The journal and scans live in `/var/lib/bulwark` (root), `~/.bulwark` (your user) or `%ProgramData%\Bulwark`, readable only by their owner. Set `BULWARK_HOME` to put them elsewhere.

## Platforms

| | Checks | Fixes |
| --- | --- | --- |
| Linux (Debian, Ubuntu, Raspberry Pi OS) | Tested on Ubuntu 24.04 | Tested: kernel settings, apply/verify/undo on the real system; SSH, sudo, accounts, files, services and firewall with simulated systems |
| Linux (Fedora, RHEL) | Updates, firewalld and everything distribution-neutral | Distribution-neutral fixes; dnf updates |
| macOS | Written against Apple's documented tools (socketfilterfw, fdesetup, spctl, csrutil, defaults, softwareupdate) | Same; not yet run on a Mac |
| Windows | PowerShell cmdlets with structured output, so the Windows language doesn't matter | Same; not yet run on Windows |

The network scanner runs anywhere Node does. It was tested against simulated devices and a real Redis server.

## Development

```bash
npm test             # 45 tests: version maths, plans and rollbacks, SSH config handling, every check against a simulated machine, the pretend network end to end, the dashboard's guards
npm install && npm run typecheck   # TypeScript checks (dev only)
```

| Folder | What's in it |
| --- | --- |
| `src/checks/` | Checks and their fixes: `ssh.ts`, `linux/`, `macos.ts`, `windows.ts`, `wifi.ts`, all listed in `index.ts` |
| `src/net/` | The network scanner: scope rules, discovery (TCP, ARP, mDNS, SSDP), one probe per protocol in `services/`, the CVE table in `fingerprints.ts`, UPnP in `upnp.ts` |
| `src/core/` | Transactions with dry runs and rollback (`tx.ts`), the fix lifecycle (`fixer.ts`), scans, scoring, reports and storage |
| `src/server.ts`, `ui/` | The dashboard: a small Node server and a page with no build step |
| `tests/` | Tests, a simulated machine (`helpers/fake-host.ts`) and the pretend network (`helpers/fake-lan.ts`) |

To add a check, write a `Check` (what to look at, what it means) and, if it can be fixed, a `Fix` whose `apply` only changes the system through the transaction it's given. Dry runs, plans, verification and undo then come for free.
