#!/bin/bash

# Run Certbot to obtain or renew certificates
#certbot --nginx --non-interactive --agree-tos --email admin@idiot.lt -d dev.bho.lt -d shazam.bho.lt

/etc/init.d/nginx stop

# Start Nginx in the foreground
nginx -g "daemon off;"

