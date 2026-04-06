# 🏷️ Comprecio — Red Social de Precios Colaborativa

## ¿Cómo correr el proyecto?

### Requisitos
- Node.js 18+ (https://nodejs.org)

### Pasos

1. Abrí una terminal en esta carpeta (`comprecio-app/`)
2. Instalá las dependencias:
   ```
   npm install
   ```
3. Iniciá el servidor:
   ```
   npm start
   ```
4. Abrí el navegador en: **http://localhost:3000**

---

## Funcionalidades del MVP

- 🗺️ **Mapa interactivo** con negocios marcados (verde = verificado, gris = sin verificar)
- 📊 **Ranking de precios** por producto, categoría o negocio
- ➕ **Reportar precios** con lógica anti-duplicados:
  - Mismo precio → confirmación automática
  - Precio distinto → actualización con historial
  - Precio nuevo → creación de registro
- ✅ **Sistema de reacciones**: confirmar, disputar, sin stock, en oferta
- 👤 **Sistema de puntos y badges** para usuarios
- 🏪 **Panel del comerciante** para gestionar su propio negocio
- 📍 **Geolocalización** para registrar y encontrar negocios cercanos

## Roles de usuario

| Rol | Descripción |
|-----|-------------|
| Consumidor | Busca precios, reporta, reacciona |
| Comerciante | Además gestiona su propio local y precios |

## Estructura del proyecto

```
comprecio-app/
├── server.js          # Servidor Express principal
├── src/
│   ├── db.js          # Base de datos SQLite
│   ├── middleware/
│   │   └── auth.js    # Autenticación JWT
│   └── routes/
│       ├── auth.js    # Registro e inicio de sesión
│       ├── businesses.js  # Negocios y geolocalización
│       ├── products.js    # Catálogo de productos
│       ├── prices.js      # Precios con deduplicación
│       └── ranking.js     # Rankings
└── public/
    ├── index.html     # Frontend SPA
    └── js/app.js      # Lógica del frontend
```
