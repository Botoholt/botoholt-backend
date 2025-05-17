# Use the official Nginx base image from Docker Hub
FROM nginx:latest

# Remove the default Nginx configuration file
RUN rm /etc/nginx/conf.d/default.conf

# Install Certbot and its Nginx plugin
#RUN apt-get update && apt-get install -y certbot python3-certbot-nginx

# Copy the first custom Nginx site configuration file
COPY bholt.conf /etc/nginx/conf.d/bholt.conf

COPY cert.crt /etc/ssl/cert.crt
COPY cert.key /etc/ssl/cert.key
# Copy the second custom Nginx site configuration file
#COPY site2.conf /etc/nginx/conf.d/site2.conf

# Expose ports 80 and 443
EXPOSE 80
EXPOSE 443

# Copy the entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod a+x /usr/local/bin/entrypoint.sh

# Create directories for mounting website files
RUN mkdir -p /var/www/bho.lt
VOLUME ["/var/www/bho.lt"]
RUN mkdir -p /var/www/shazam.bho.lt
VOLUME ["/var/www/shazam.bho.lt"]


# Add a cron job for Certbot certificate renewal
#RUN echo "0 12 * * * certbot renew --nginx --noninteractive --post-hook 'nginx -s reload'" >> /etc/crontab

# Start Nginx in the foreground
CMD ["/bin/bash", "-c", "nginx;/usr/local/bin/entrypoint.sh"]
