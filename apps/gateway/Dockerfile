FROM nginx:stable-alpine
COPY deploy/k8s/gateway.conf /etc/nginx/nginx.conf
COPY apps/admin/ /usr/share/nginx/html/admin-ui/
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
