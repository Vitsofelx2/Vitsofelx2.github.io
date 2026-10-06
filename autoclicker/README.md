# AutoClicker para PC

App de escritorio (Windows, macOS y Linux) para hacer clics automáticos.

## Funciones

- **Intervalo** configurable en horas, minutos, segundos y milisegundos.
- **Botón**: izquierdo, derecho o central.
- **Tipo de clic**: simple, doble o triple.
- **Repetición**: un número fijo de veces o hasta que lo detengas.
- **Posición**: donde esté el cursor o en una ubicación fija (botón "Elegir ubicación" y luego haz clic en la pantalla).
- **Atajo global F6** para iniciar/detener, aunque la ventana no esté activa.
- La ventana se mantiene siempre encima de las demás.

## Opción 1: descargar el .exe (Windows)

1. En GitHub, ve a la pestaña **Actions** → **Build AutoClicker**.
2. Abre la última ejecución correcta y descarga el artefacto **AutoClicker-windows**.
3. Descomprime y ejecuta `AutoClicker.exe`. No necesitas instalar Python.

> Windows SmartScreen puede avisar porque el ejecutable no está firmado: pulsa "Más información" → "Ejecutar de todas formas".

## Opción 2: ejecutar con Python

```bash
cd autoclicker
pip install -r requirements.txt
python autoclicker.py
```

En Linux también necesitas Tkinter (`sudo apt install python3-tk`). En macOS, concede permisos de **Accesibilidad** a la terminal o a la app en *Ajustes del Sistema → Privacidad y seguridad*.

## Crear el .exe tú mismo

```bash
pip install pyinstaller pynput
pyinstaller --onefile --windowed --name AutoClicker autoclicker.py
```

El ejecutable queda en `dist/AutoClicker.exe`.
