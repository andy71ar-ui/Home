# Control del hogar local

Esta carpeta contiene una copia local del sitio `control-hogar-andrea.andy71ar.chatgpt.site`, servida desde tu propia PC.

## Iniciar

Doble clic en:
 
```text
iniciar-control-hogar.bat
```

O desde PowerShell:

```powershell
node server.js
```

Luego abrir:

```text
http://localhost:3101
```

## Datos

La app guarda los datos cifrados en el navegador, igual que el sitio original. Para llevar los datos a otra PC, usá dentro de la app:

```text
Configuración -> Descargar respaldo
```

En la otra PC:

```text
Configuración -> Importar respaldo
```

El respaldo queda cifrado con la contraseña que uses en la app.

## Funciones incluidas

- Resumen mensual.
- Movimientos.
- Cuentas, bancos y billeteras.
- Tarjetas y consumos futuros.
- Vencimientos.
- Préstamos.
- Lectura de documentos PDF con PDF.js local.
- Rubros de gastos e ingresos, y lugares/servicios.
- Cambio de contraseña.
- Respaldo cifrado.
- Uso offline mediante service worker.

## Notas

- No depende del hosting de ChatGPT.
- Los archivos `app.js`, `styles.css`, `sw.js` y PDF.js están dentro de `public`.
- El servidor local solo entrega archivos; no sube datos a internet.
