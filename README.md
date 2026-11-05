# Control del hogar

El sitio de uso habitual es https://control-hogar-andy71ar.web.app/, publicado en Firebase. Esta carpeta contiene su código y también permite ejecutarlo localmente.

## Control mensual de lugares y servicios

- **Lugares y servicios** muestra todos los lugares guardados cada mes, incluso cuando no hay factura ni vencimiento cargado. **Pagado** aparece en verde y **No pagado** en rojo.
- Se reconocen gastos vinculados y facturas pagadas del período. Si hay una factura pendiente con importe conocido, un gasto parcial no confirma por sí solo el pago completo.
- **Marcar pagado** confirma únicamente el control de ese mes, sin crear un gasto ni cambiar saldos. La marca se guarda en Firebase y en los respaldos, por lugar y mes.
- **Registrar gasto** permite elegir **Mes que estás pagando** para asociar un pago atrasado al período correcto, conservando su fecha real en Movimientos.
- El selector de mes y los botones de mes anterior/siguiente permiten consultar el historial. En Resumen se avisa qué cantidad de lugares sigue sin confirmación de pago.

## Dólares

- **Resumen dólares** muestra por separado las cuentas de Banco Nación, Santander e ICBC. Desde cada cuenta se puede editar el saldo inicial en USD.
- **Movimientos dólares** permite registrar ingresos, gastos, transferencias entre cuentas en USD y pagos de tarjeta.
- En **Tarjetas**, **Registrar pago en dólares** descuenta únicamente los USD pendientes del resumen elegido y de la cuenta de origen. Admite pagos parciales o totales; la parte en pesos se registra por separado.
- Los saldos en dólares cargados con la versión anterior se trasladan una sola vez a las cuentas en USD. Los movimientos antiguos sin moneda se siguen considerando en pesos.

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

## Modo nube con Firebase

La app puede seguir funcionando localmente como hasta ahora. Para activar sincronización en la nube:

1. Crear un proyecto en Firebase.
2. Activar Authentication con Email/Password.
3. Crear una base Cloud Firestore.
4. Copiar la configuración de la app web en `public/firebase-config.js` y cambiar `enabled` a `true`.
5. Publicar Hosting y reglas de Firestore:

```powershell
firebase deploy --only hosting,firestore:rules
```

Los datos se guardan por usuario en Firestore bajo `users/{uid}/...`. Las reglas de `firestore.rules` permiten que cada usuario autenticado lea y escriba solamente sus propios datos.

Desde Configuración -> Descargar respaldo, también en modo nube se baja un JSON cifrado. Ese respaldo puede importarse luego en la misma cuenta o en una instalación local.

## Notas

- No depende del hosting de ChatGPT.
- Los archivos `app.js`, `styles.css`, `sw.js` y PDF.js están dentro de `public`.
- El servidor local solo entrega archivos; no sube datos a internet.
