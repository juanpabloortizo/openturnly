# Deploying on an Azure VM, step by step

This guide puts OpenTurnly on a small Azure virtual machine with your own domain and HTTPS:
Ubuntu, Docker, OpenTurnly with its PostgreSQL, and [Caddy](https://caddyserver.com) in
front for the certificates. It takes about 20 minutes. The same steps work on any Ubuntu
server (DigitalOcean, Hetzner, AWS…) from [step 3](#3-connect-over-ssh) on.

You need:

- An Azure subscription and the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
  signed in (`az login`).
- A domain whose DNS you manage. This guide uses Cloudflare; any DNS provider works the
  same way.

## 1. Create the virtual machine

Two vCPUs and 4 GB of RAM are plenty: OpenTurnly and PostgreSQL use about 200 MB, and the
rest leaves room to build the image and host many businesses. Good sizes are
`Standard_B2als_v2` (burstable, cheapest) or `Standard_D2als_v6` / `Standard_D2als_v7`
(steady performance). Pick a region close to your customers.

Save this as `cloud-init.yaml`. It installs Docker from Docker's own repository, turns on
automatic security updates, adds 2 GB of swap for image builds, blocks SSH passwords and
root logins, and bans addresses that keep failing to sign in over SSH (fail2ban):

```yaml
#cloud-config
package_update: true
package_upgrade: true
packages: [ca-certificates, curl, git, fail2ban, unattended-upgrades]

write_files:
  - path: /etc/ssh/sshd_config.d/10-openturnly.conf
    content: |
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PermitRootLogin no

runcmd:
  - fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  - echo '/swapfile none swap sw 0 0' >> /etc/fstab
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  - usermod -aG docker openturnly
  - systemctl enable --now docker fail2ban
  - systemctl reload ssh
```

Create an SSH key for this server, then the VM, then open the web ports:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/openturnly_azure -C openturnly-azure

az group create --name openturnly --location eastus2

az vm create --resource-group openturnly --name openturnly --location eastus2 \
  --image Canonical:ubuntu-24_04-lts:server:latest --size Standard_B2als_v2 \
  --admin-username openturnly --authentication-type ssh \
  --ssh-key-values ~/.ssh/openturnly_azure.pub \
  --public-ip-sku Standard --public-ip-address-dns-name openturnly-<something-unique> \
  --storage-sku StandardSSD_LRS --os-disk-size-gb 32 \
  --nsg-rule SSH --custom-data cloud-init.yaml

az vm open-port --resource-group openturnly --name openturnly --port 80,443 --priority 1010
```

The output shows the `publicIpAddress` (fixed, it won't change) and a name like
`openturnly-<something-unique>.eastus2.cloudapp.azure.com`. Note both.

If Azure answers `SkuNotAvailable`, that size has no free capacity in that region right
now: try another size from the list above or a nearby region. Nothing is created or
charged when it fails.

## 2. Point your domain at the server (Cloudflare)

Choose the address your customers will use, for example `citas.yourbusiness.com`.

1. In Cloudflare, open your domain and go to **DNS → Records → Add record**.
2. Fill it in:
   - **Type**: `A`
   - **Name**: `citas` (only the part before your domain; use `@` for the bare domain)
   - **IPv4 address**: the VM's public IP
   - **Proxy status**: **DNS only** (grey cloud)
   - **TTL**: Auto
3. Save.

Keep it on **DNS only**. With Cloudflare's proxy (orange cloud) in front, every visitor
would reach OpenTurnly from a Cloudflare address, so its sign-in and anti-bot limits would
treat them all as one person, and the certificate setup below needs to reach the server
directly.

Check it from your computer after a minute; it should print the VM's IP:

```bash
dig +short citas.yourbusiness.com
```

No domain yet? You can use the Azure name from step 1
(`openturnly-<something-unique>.eastus2.cloudapp.azure.com`) everywhere below, and switch
later.

## 3. Connect over SSH

```bash
ssh -i ~/.ssh/openturnly_azure openturnly@<public IP or Azure name>
```

Check that the setup finished and Docker works:

```bash
cloud-init status --wait
docker run --rm hello-world
```

## 4. Install OpenTurnly

```bash
git clone https://github.com/juanpabloortizo/openturnly.git
cd openturnly
```

Create `.env` with your address and a strong database password (set it now: it only takes
effect the first time PostgreSQL starts):

```bash
cat > .env <<EOF
APP_URL=https://citas.yourbusiness.com
POSTGRES_PASSWORD=$(openssl rand -base64 30 | tr -d '/+=')
TRUST_PROXY=true
EOF
```

Create the `Caddyfile`, which gets and renews the HTTPS certificate on its own:

```bash
cat > Caddyfile <<EOF
citas.yourbusiness.com {
  reverse_proxy openturnly:3000
}
EOF
```

And `compose.override.yml`, which adds Caddy on ports 80 and 443 and keeps OpenTurnly
reachable only through it:

```bash
cat > compose.override.yml <<'EOF'
services:
  openturnly:
    ports: !reset []
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on: [openturnly]
volumes:
  caddy-data:
EOF
```

Build and start everything (the first build takes a few minutes):

```bash
docker compose up -d --build
docker compose ps
```

Open `https://citas.yourbusiness.com` and **create the owner account right away**: until
an owner exists, whoever opens the page first can create it.

## 5. Backups

Bookings live in PostgreSQL. This saves a copy every night at 3:00 and keeps the last 14:

```bash
mkdir -p ~/backups
( crontab -l 2>/dev/null; echo '0 3 * * * cd ~/openturnly && docker compose exec -T db pg_dump -U openturnly -Fc openturnly > ~/backups/openturnly-$(date +\%F).dump && ls -t ~/backups/*.dump | tail -n +15 | xargs -r rm' ) | crontab -
```

Copies on the same VM don't survive losing the VM: download them now and then
(`scp -i ~/.ssh/openturnly_azure openturnly@<server>:backups/*.dump .`) or send them to
storage such as Azure Blob, Backblaze B2 or Cloudflare R2. Restoring is in the
[self-hosting guide](self-hosting.md#backups).

## 6. Updates

```bash
cd ~/openturnly
docker compose exec -T db pg_dump -U openturnly -Fc openturnly > ~/backups/before-update.dump
git pull
docker compose up -d --build
```

Database migrations run on their own when OpenTurnly starts. Ubuntu's security updates
install themselves; reboot now and then with `sudo reboot` when `/var/run/reboot-required`
exists. The containers start again by themselves.

## Troubleshooting

- **The browser says the certificate isn't valid**: the DNS record isn't pointing at the
  server yet, or it's proxied (orange cloud). Fix it, then `docker compose restart caddy`.
  `docker compose logs caddy` shows what Let's Encrypt answered.
- **502 Bad Gateway**: OpenTurnly is still starting or failed to. See
  `docker compose logs -f openturnly`.
- **Invitation or booking links show the wrong address**: fix `APP_URL` in `.env`, then
  `docker compose up -d`.
- **Moving to another domain**: add the new DNS record, change `APP_URL` and the
  `Caddyfile`, then `docker compose up -d` and `docker compose restart caddy`.
- **Your IP changed and SSH stopped working**: only if you limited SSH to your IP. Update
  the `default-allow-ssh` rule of the VM's network security group in the Azure portal.
