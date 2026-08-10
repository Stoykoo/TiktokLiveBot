# Usar una imagen oficial de Node.js ultra ligera basada en Alpine Linux
FROM node:20-alpine

# Establecer el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# Copiar el resto del código del proyecto
COPY . .

# Exponer el puerto para el servidor HTTP de salud / keep-alive
EXPOSE 3000

# Comando por defecto para iniciar el bot
CMD ["node", "src/index.js"]
