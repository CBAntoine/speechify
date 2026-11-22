# Bulwark

Bulwark finds the security holes in your devices and software, and fixes them.

1. **This device.** It checks the computer it runs on: waiting security updates, the firewall, SSH settings, accounts with no password or a factory password, passwordless sudo, file permissions, kernel hardening, risky services like Telnet or an open Redis, disk encryption and Wi-Fi encryption. Linux, macOS and Windows each get their own checks.
2. **Installed software.** It checks whether the operating system still gets security updates (Ubuntu, Debian, Raspberry Pi OS, Fedora, RHEL, Alpine, Windows 10 and 11 by version, macOS), whether Node.js, Python, Go, PHP and Ruby are still supported, which apps have updates waiting in Homebrew, winget, snap and Flatpak (browsers, chat apps, PDF readers and archivers first), and whether a version with a known, exploited flaw is installed (7-Zip, WinRAR, PuTTY, the xz backdoor).
3. **The software you build.** Point it at a folder and it finds your code projects, reads their lockfiles (npm, pnpm, Yarn, pip, Poetry, uv, Pipenv, Cargo, Go, Bundler, Composer, NuGet, Gradle) and checks every exact dependency version against [OSV.dev](https://osv.dev), the open vulnerability database, so you see each vulnerable package with its CVEs, how serious they are and which version fixes them.
4. **Your Android phone and TV.** It runs on an Android phone (in Termux) and checks it, and through Android's debugging connection, which you allow on the device's own screen, it checks and fixes Android phones, tablets and TVs (Android TV, Google TV, Fire TV): security patch age, Android versions that no longer get fixes, an unlocked bootloader, SELinux, encryption, root, the screen lock, Play Protect, apps allowed to install other apps, apps from outside an app store, an outdated WebView, and debugging left open on the network.
5. **Every device on your Wi-Fi.** If you ask it to, it finds every device on your network, including the quiet ones like phones and smart plugs, and works out what each one is and who made it. It then checks each one: open services (Telnet, unencrypted logins, old firmware with known CVEs, SMBv1, Remote Desktop without NLA, VNC, databases and APIs with no password), Windows PCs and Macs that no longer get security updates, smart plugs anyone can switch, a Home Assistant nobody has claimed, old Hue bridges and QNAP firmware, Roku remote control, and the port forwards your router opened by itself through UPnP. It remembers your devices and flags any new one that joins, so you notice someone using your Wi-Fi.
6. **Other computers, over SSH.** A Linux machine, Raspberry Pi or Mac on your network can be checked and fixed from here with your own login, with the same checks, plans and undo as on this computer.
7. **Fixes.** Most problems on this device, outdated apps, vulnerable dependencies, Android settings, computers reached over SSH and the router's UPnP port forwards have an automatic fix. Before anything changes, Bulwark shows you exactly what it will do: every file diff and every command. It checks that the fix can't lock you out, applies it, checks again that the problem is gone, and keeps a record so you can undo it later. Problems it can't fix itself (a camera's Telnet, a router's admin page) come with step-by-step instructions.

It has a dashboard in your browser and a command line, and no dependencies: just Node.js.

## Run it

You need [Node.js](https://nodejs.org) 22.6 or newer. There's nothing to install.

```bash
cd bulwark
./bulwark scan                 # check this device (about 10 seconds)
./bulwark scan --code ~/code   # the code projects in a folder
./bulwark scan --network       # …and every device on your network (about a minute)
./bulwark serve --sudo         # the dashboard: open the link it prints
```

On Windows, use `bulwark.cmd` instead of `./bulwark`, from a terminal opened with "Run as administrator".

Most fixes change system settings, so they need admin rights. Add `--sudo` (it re-runs the command with sudo and finds Node even when sudo's PATH doesn't) or run the commands with `sudo`. Without admin rights Bulwark still scans, and says which checks it had to skip.

**Try it on a pretend network first:** `npm run demo` starts ten fake devices on this computer's loopback addresses (a router with UPnP forwards, a camera with an open Telnet shell, a NAS with SMBv1 and an open Redis, a Windows 10 PC, an unclaimed Home Assistant, two smart plugs (one of them "new"), an Android TV box with open debugging and more), two small code projects with vulnerable dependencies and a pretend Android TV that answers over a stand-in adb, scans them and opens the dashboard on port 7078. The fixes there are real, against the pretend router, projects and TV.

## On your Android phone and TV

**On the phone.** Install [Termux](https://f-droid.org/packages/com.termux/) from F-Droid (the Play Store version is outdated), and optionally Termux:Widget for a home-screen button. In Termux:

```bash
pkg install -y git
git clone <this repository's URL>
bash speechify/bulwark/android/install-termux.sh
bulwark scan                  # this phone: Android version, patches, bootloader, encryption, debugging, Termux's packages
bulwark serve --open          # the dashboard, in the phone's browser
```

The installer adds Node.js, git and adb from Termux's packages, a `bulwark` command, and two Termux:Widget shortcuts ("Bulwark" and "Bulwark on the TV"). No root needed.

An app on its own can only read a little about Android. To check the screen lock, Play Protect and app permissions too, and to fix them, connect the phone to itself over Wireless debugging (Android 11+): Settings → System → Developer options → Wireless debugging → "Pair device with pairing code". With Termux and Settings side by side in split screen (the code disappears when you switch apps):

```bash
bulwark android pair 127.0.0.1:<pairing port> <6-digit code>
bulwark android connect 127.0.0.1:<port shown on the Wireless debugging screen>
bulwark scan --android
```

The dashboard's **Phones & TVs** tab walks through the same steps.

**The TV (Android TV, Google TV, Fire TV).** Turn on Developer options (Settings → Device Preferences → About → select Build seven times; on Fire TV, Settings → My Fire TV → About → select its name seven times), turn on USB/ADB debugging (and Network debugging, if there is one), then from the phone or a computer:

```bash
bulwark android connect <the TV's IP address>   # the TV asks "Allow USB debugging?": choose OK
bulwark scan --android
bulwark fix 3                                   # review and apply a fix, as usual
```

When you're done, apply the "Turn off debugging on the device" fix (it's listed as a finding): debugging gives whoever connects full control, so it shouldn't stay on. Do it last, because it ends the connection.

**Samsung, LG and Roku TVs** don't run Android, so they can't be connected this way. `bulwark scan --network` recognises them and checks what they open to the network; a Roku that lets any device on the Wi-Fi control it, or that has developer mode on, gets steps to lock it down.

**The dashboard on the TV's screen.** `bulwark serve --lan` (or the "Bulwark on the TV" shortcut) also serves the dashboard on the phone's Wi-Fi address and prints a 6-digit code. Open the address it prints in the TV's browser and enter the code with the remote. Everything works with the remote's arrow keys and Back.

## Every device on your Wi-Fi

```bash
./bulwark scan --network                   # find and check every device on your network
./bulwark devices                          # the list: what each one is, and which are new
./bulwark devices name 192.168.1.77 "Sam's phone"   # name one, and mark it as yours
./bulwark ssh pi@192.168.1.40              # check a Linux machine or Mac with your login, then
./bulwark fix 3                            # fix its problems like this computer's
```

**Finding them.** Bulwark asks the network in several ways, because each kind of device answers a different one: ping (phones), Bonjour (Apple devices, printers, speakers), NetBIOS (Windows PCs), UPnP (routers, TVs), a knock on common ports (everything with a service), and the computer's own neighbour table. It names each one from what it says about itself (its Bonjour, Windows or UPnP name, its web page, the router's records), and its maker from its hardware address, using the IEEE's register of makers (Espressif usually means a smart plug or bulb, Nintendo a Switch).

**Checking them.** Besides the open services above:

- **Windows PCs.** The first step of an SMB connection, before any user name or password, gives away the Windows version. Bulwark spots Windows 7, 8 and 10 (out of support since October 2025) and Windows 11 versions past their end, and names the PC.
- **Macs** that announce an old macOS through Bonjour.
- **Smart plugs and switches.** Shelly and Tasmota devices without a password, and TP-Link Kasa plugs that take commands from anyone.
- **Home Assistant** that nobody has set up yet (the first person to open it becomes its owner), first-generation **Hue bridges** (no updates since 2020), and **QNAP** NAS firmware more than a year old.
- **Phones, consoles and speakers**, which show nothing from the network, get what to check on the device itself.

**Knowing what's yours.** The first network scan is the baseline. Any device that joins later is flagged as new until you say it's yours ("It's mine" in the dashboard, or `bulwark devices name`). Phones keep the same private address on a network, so they're recognised the next time too.

**Fixing computers over SSH.** For a Linux machine (a Raspberry Pi, a home server) or a Mac with Remote Login on, Bulwark logs in with your account and runs this computer's checks and fixes there, through your own `ssh`. Your keys work as they are. A password is used once, through ssh's own password helper, to open a shared connection that later commands reuse, and it's never stored. Most fixes need admin rights there: log in as root, or as a user whose sudo doesn't ask for a password. In the dashboard, open the computer in the Network tab and choose "Check inside it over SSH". Windows PCs aren't reached this way; run Bulwark on them instead.

## Command line

| Command | What it does |
| --- | --- |
| `bulwark scan` | Check this device and its installed software. Add `--code <folder>` for code projects, `--android` for phones and TVs connected with adb, `--network` for your network, or `--target 192.168.1.0/24` (repeatable) for specific addresses |
| `bulwark devices` | Every device on your network from the last scan, with the new ones marked. `bulwark devices name <ip> <name>` names one and marks it as yours |
| `bulwark ssh <user>@<address>` | Check another computer (Linux, macOS) over SSH. Its findings join the last scan, so `bulwark fix <number>` and `bulwark rollback` work on it |
| `bulwark android` | The phones and TVs connected with adb, and how to connect one. `bulwark android connect <address>` and `bulwark android pair <address:port> <code>` connect one |
| `bulwark fix 3` | Show the plan for problem 3 from the last scan, then apply it if you say yes. Several numbers at once work too |
| `bulwark fix --all-safe` | Apply every low-risk fix (file permissions, kernel settings, SSH root login, macOS and Windows switches) |
| `bulwark fix 3 --dry-run` | Show the plan only |
| `bulwark rollback <id>` / `--last` | Undo a change |
| `bulwark history` | Every change Bulwark has made, with its result |
| `bulwark report` | The last scan as Markdown (`--format json` for JSON) |
| `bulwark checks` | Everything Bulwark checks for |
| `bulwark serve` | The dashboard on http://127.0.0.1:7077 (`--port` to change it, `--open` to open the browser, `--lan` so a TV or tablet on your Wi-Fi can open it too) |

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
| Installed software | Operating system and runtime (Node.js, Python, Go, PHP, Ruby) end of support; apps with updates waiting in Homebrew, winget, snap and Flatpak; 7-Zip, WinRAR and PuTTY versions with exploited flaws; xz 5.6.0/5.6.1 | Update the apps with their package manager (Homebrew runs as its owner, never root). Operating system and runtime upgrades come with instructions |
| Code projects | Every exact dependency version in the lockfiles, against OSV.dev: CVE and GitHub advisory ids, severity, the version that fixes each one, development-only dependencies counted lower | npm (`npm audit fix --package-lock-only`), pnpm, Poetry, uv, Cargo, Go, Bundler and Composer through their own tools, run as the project's owner; pinned `requirements.txt` lines edited in place. Lockfiles are copied first, so undo restores them exactly |
| Android phones and TVs (over adb) | Security patch age, Android versions past Google's support (Fire OS too), unlocked bootloader or failed verified boot, SELinux off, unencrypted storage, root, no screen lock, Play Protect off, apps allowed to install other apps, apps from outside an app store, an old WebView, debugging on (critical when a TV accepts it from the whole network) | Turn Play Protect back on; take "install unknown apps" back from apps that aren't stores; turn debugging off (last). Settings changes are undone by restoring the old value. Updates and the rest come with steps for that device's Settings menus |
| This phone (Termux) | The same checks that an app can make on its own (from Android's system properties), plus Termux's own packages | Update Termux's packages (`pkg upgrade`, keeping your configuration files) |
| Network devices | Telnet (and Telnet that drops into a shell with no password), FTP, SSH versions, Terrapin (CVE-2023-48795) and weak SSH crypto, web logins over plain HTTP, TLS 1.0/1.1, expired certificates, open folder listings, SMBv1, RDP without NLA, VNC without a password, open Redis, Memcached, MongoDB, Elasticsearch, CouchDB and Docker APIs, anonymous MQTT, open Android debugging, exposed databases, camera streams with no login, Xiongmai/Dahua control ports, Roku remote control open to the network and Roku developer mode, Windows PCs and Macs past their end of support, Shelly/Tasmota switches without a password and open Kasa plugs, unclaimed Home Assistant, old Hue bridges and QNAP firmware, new devices on the network, and known-vulnerable versions (regreSSHion, old Dropbear, vsftpd 2.3.4, Apache 2.4.49/50, Heartbleed-era OpenSSL, Boa, RomPager, MiniUPnPd, RediShell, MongoBleed, end-of-life Ubuntu and Debian) | Remove the router's UPnP port forwards (undo puts them back). Everything else comes with instructions for that device, and advice for each kind of device |
| Computers over SSH (Linux, macOS) | Everything this computer is checked for | The same fixes, applied on that computer, checked there, and undone there |

## How it keeps you safe

- **It only scans what's yours.** Without targets it scans the private network this computer is on, cut down to its /24, and asks you to confirm it's your network the first time. Public internet addresses (carrier-grade NAT ones included, since they belong to your ISP's other customers) need an explicit "I own these or have permission" (`--authorized`) and are capped at 256. Multicast and reserved addresses are never scanned, and no scan goes over 4,096 addresses.
- **It never tries passwords on other devices.** Network checks only ask a service what it accepts (which SMB versions, which VNC login methods, whether MQTT or Redis want a password) and read what it announces: a Windows PC's version comes from the step of an SMB connection before any login, a smart plug's from the info page its app reads. Bulwark logs in to a computer only when you ask it to check one over SSH, with your own account.
- **SSH is your own ssh.** Bulwark runs the system's `ssh` with your keys and known hosts. It accepts a computer's key the first time and refuses to connect if it changes later (which can mean someone is intercepting). A password, if you give one, goes to ssh through its password helper, opens one shared connection, and is forgotten; the dashboard only accepts it when typed on the device running Bulwark, never from another device over the network. Only private (home network) addresses are reached. The factory-password check only compares this computer's own password hashes, locally, with Perl's `crypt()`, through stdin.
- **Phones and TVs are only reached the way Android allows.** Bulwark connects through adb, which the device's owner has to turn on and then approve on the device's own screen, and only to private addresses (your Wi-Fi, or 127.0.0.1 for the phone it runs on). It reads settings with the same commands Android's own tools use, changes only the settings a fix names, and suggests turning debugging off when you're done.
- **A phone never scans its mobile network.** Mobile data connections (rmnet, ccmni and the like) are left out of "your network": their neighbours are other customers' phones.
- **Every fix is a plan first.** You see each file diff and command before anything changes. Fixes that could lock you out or disrupt something are marked "needs care" and are never part of "fix all".
- **Every fix is checked and can be undone.** Bulwark checks preconditions, applies the change, validates it (for example `sshd -t` before reloading SSH), re-runs the check, and undoes everything automatically if a step fails. Backups of every file it touches go into a journal, so `bulwark rollback` puts back files, permissions, services and router forwards exactly as they were. It refuses to undo over a file you've edited since.
- **Fixes use what's true now.** Before planning or applying a fix, Bulwark re-runs the check on the live system and takes the fix's details from that, not from a saved scan.
- **Code checks send only package names and versions.** For `--code` scans, the name and version of each dependency goes to osv.dev (through your proxy if `HTTPS_PROXY` is set). File contents, paths and project names stay on the computer. Results are cached for a day.
- **Project fixes never run as root.** When Bulwark runs with sudo, the npm, Poetry, Cargo (and so on) commands run as the user who owns the project folder, and npm only rewrites the lockfile (no install scripts run). If a fix jumps to a new major version, the plan says so before you apply it.
- **The dashboard is locked down.** It listens on 127.0.0.1 only (with `--lan`, also on the Wi-Fi address, never on mobile data or a VPN), needs a random key on every request (it's in the link Bulwark prints; with `--lan` a TV can trade a one-time 6-digit code for it, which works once, for 30 minutes, and switches off after five wrong guesses), refuses unexpected Host headers (DNS rebinding), sends no CORS headers, accepts only JSON, and serves a strict Content-Security-Policy. A request can only say *which* finding to fix, never what the fix does. Everything shown from the network (device names, banners, page titles) is escaped.
- **Its own files are private.** The journal and scans live in `/var/lib/bulwark` (root), `~/.bulwark` (your user) or `%ProgramData%\Bulwark`, readable only by their owner. Set `BULWARK_HOME` to put them elsewhere.

## Platforms

| | Checks | Fixes |
| --- | --- | --- |
| Linux (Debian, Ubuntu, Raspberry Pi OS) | Tested on Ubuntu 24.04 | Tested: kernel settings, apply/verify/undo on the real system; SSH, sudo, accounts, files, services and firewall with simulated systems |
| Linux (Fedora, RHEL) | Updates, firewalld and everything distribution-neutral | Distribution-neutral fixes; dnf updates |
| macOS | Written against Apple's documented tools (socketfilterfw, fdesetup, spctl, csrutil, defaults, softwareupdate) | Same; not yet run on a Mac |
| Windows | PowerShell cmdlets with structured output, so the Windows language doesn't matter | Same; not yet run on Windows |
| Android phones (Termux) and Android/Google/Fire TV (adb) | Written against Android's own tools (getprop, settings, cmd appops, pm, dumpsys); tested against simulated devices and a stand-in adb, and the dashboard on phone-sized and TV-sized screens | Same; not yet run on a real phone or TV |
| Other computers over SSH | Tested through a stand-in ssh that runs the commands on this machine: the whole Linux check set gives exactly the same results as running it locally | A fix, its check and its undo, through the same stand-in; not yet tried against a real SSH server |

The network scanner runs anywhere Node does. It was tested against simulated devices and a real Redis server. The code checks were tested against the real OSV.dev database with real npm and pip projects (find, fix, verify, undo), and with simulated projects for the other ecosystems.

## Development

```bash
npm test             # 94 tests: version maths, plans and rollbacks, SSH config handling, every check against a simulated machine, the pretend network end to end, the dashboard's guards, every lockfile format, OSV lookups against a stand-in server, software checks on simulated Linux, macOS and Windows, Android checks and the scan → fix → undo cycle over a stand-in adb, TV recognition, the TV sign-in code, finding and naming devices (ping, Bonjour, NetBIOS, makers, Windows versions over SMB), smart home checks, the device inventory, and checks, fixes and undo over a stand-in ssh
npm install && npm run typecheck   # TypeScript checks (dev only)
```

| Folder | What's in it |
| --- | --- |
| `src/checks/` | Checks and their fixes: `ssh.ts`, `linux/`, `macos.ts`, `windows.ts`, `wifi.ts`, all listed in `index.ts` |
| `src/net/` | The network scanner: scope rules, discovery (TCP, ping, ARP, mDNS, NetBIOS, SSDP in `discover.ts` and friends), naming (`identify.ts`, makers in `oui.ts` from the IEEE register, rebuilt with `scripts/build-oui.ts`), one probe per protocol in `services/` (Windows versions in `ntlm.ts`, smart home gear in `home.ts`), the CVE table in `fingerprints.ts`, UPnP in `upnp.ts`, the device inventory in `inventory.ts` |
| `src/remote/` | Other computers over SSH: the connection and a Host that runs every check and fix there (`ssh.ts`), scanning and re-checking (`scan.ts`) |
| `src/android/` | Android: the adb connection (`adb.ts`), the checks and fixes (`checks.ts`), scanning connected phones and TVs (`scan.ts`). `android/install-termux.sh` sets Bulwark up in Termux |
| `src/software/` | Installed software (`installed.ts`), lockfile readers (`lockfiles.ts`), the OSV client (`osv.ts`), code-project scanning and fixes (`deps.ts`) |
| `src/core/` | Transactions with dry runs and rollback (`tx.ts`), the fix lifecycle (`fixer.ts`), scans, scoring, reports, storage, and HTTPS that works behind proxies (`https.ts`) |
| `src/server.ts`, `ui/` | The dashboard: a small Node server and a page with no build step |
| `tests/` | Tests, a simulated machine (`helpers/fake-host.ts`), the pretend network (`helpers/fake-lan.ts`), a stand-in for OSV.dev (`helpers/fake-osv.ts`), a stand-in adb with a pretend Android TV (`helpers/fake-adb.mjs`) and a stand-in ssh (`helpers/fake-ssh.mjs`) |

To add a check, write a `Check` (what to look at, what it means) and, if it can be fixed, a `Fix` whose `apply` only changes the system through the transaction it's given. Dry runs, plans, verification and undo then come for free.
