"""AutoClicker para PC.

Aplicación de escritorio para hacer clics automáticos con el ratón.
Atajo global: F6 inicia/detiene los clics (funciona aunque la ventana no esté enfocada).

Requisitos: Python 3.8+ y `pip install pynput`.
"""

import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk

from pynput import keyboard, mouse

HOTKEY = keyboard.Key.f6
HOTKEY_LABEL = "F6"

BUTTONS = {
    "Izquierdo": mouse.Button.left,
    "Derecho": mouse.Button.right,
    "Central": mouse.Button.middle,
}
CLICK_TYPES = {"Simple": 1, "Doble": 2, "Triple": 3}


class AutoClicker:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.mouse = mouse.Controller()
        self.stop_event = threading.Event()
        self.worker = None
        self.picking = False

        root.title("AutoClicker")
        root.resizable(False, False)
        root.attributes("-topmost", True)

        self._build_ui()

        self.kb_listener = keyboard.Listener(on_press=self._on_key)
        self.kb_listener.daemon = True
        self.kb_listener.start()

        root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ---------- interfaz ----------
    def _build_ui(self):
        pad = {"padx": 8, "pady": 4}
        main = ttk.Frame(self.root, padding=10)
        main.grid()

        # Intervalo
        interval = ttk.LabelFrame(main, text="Intervalo entre clics")
        interval.grid(row=0, column=0, columnspan=2, sticky="ew", **pad)
        self.hours = tk.StringVar(value="0")
        self.minutes = tk.StringVar(value="0")
        self.seconds = tk.StringVar(value="0")
        self.millis = tk.StringVar(value="100")
        for col, (var, label) in enumerate(
            [(self.hours, "horas"), (self.minutes, "min"), (self.seconds, "seg"), (self.millis, "ms")]
        ):
            ttk.Spinbox(interval, from_=0, to=99999, width=6, textvariable=var).grid(
                row=0, column=col * 2, padx=(8, 2), pady=6
            )
            ttk.Label(interval, text=label).grid(row=0, column=col * 2 + 1, padx=(0, 6))

        # Opciones de clic
        options = ttk.LabelFrame(main, text="Opciones de clic")
        options.grid(row=1, column=0, sticky="nsew", **pad)
        ttk.Label(options, text="Botón:").grid(row=0, column=0, sticky="w", padx=8, pady=4)
        self.button = tk.StringVar(value="Izquierdo")
        ttk.Combobox(options, textvariable=self.button, values=list(BUTTONS), state="readonly", width=10).grid(
            row=0, column=1, padx=8, pady=4
        )
        ttk.Label(options, text="Tipo:").grid(row=1, column=0, sticky="w", padx=8, pady=4)
        self.click_type = tk.StringVar(value="Simple")
        ttk.Combobox(
            options, textvariable=self.click_type, values=list(CLICK_TYPES), state="readonly", width=10
        ).grid(row=1, column=1, padx=8, pady=4)

        # Repetición
        repeat = ttk.LabelFrame(main, text="Repetición")
        repeat.grid(row=1, column=1, sticky="nsew", **pad)
        self.repeat_mode = tk.StringVar(value="infinite")
        self.repeat_count = tk.StringVar(value="10")
        ttk.Radiobutton(repeat, text="Repetir", variable=self.repeat_mode, value="count").grid(
            row=0, column=0, sticky="w", padx=8, pady=4
        )
        ttk.Spinbox(repeat, from_=1, to=10**9, width=7, textvariable=self.repeat_count).grid(row=0, column=1)
        ttk.Label(repeat, text="veces").grid(row=0, column=2, padx=(2, 8))
        ttk.Radiobutton(repeat, text="Hasta detener", variable=self.repeat_mode, value="infinite").grid(
            row=1, column=0, columnspan=3, sticky="w", padx=8, pady=4
        )

        # Posición
        position = ttk.LabelFrame(main, text="Posición del cursor")
        position.grid(row=2, column=0, columnspan=2, sticky="ew", **pad)
        self.pos_mode = tk.StringVar(value="current")
        self.pos_x = tk.StringVar(value="0")
        self.pos_y = tk.StringVar(value="0")
        ttk.Radiobutton(position, text="Posición actual", variable=self.pos_mode, value="current").grid(
            row=0, column=0, columnspan=6, sticky="w", padx=8, pady=4
        )
        ttk.Radiobutton(position, text="Fija:", variable=self.pos_mode, value="fixed").grid(
            row=1, column=0, sticky="w", padx=8, pady=4
        )
        ttk.Label(position, text="X").grid(row=1, column=1)
        ttk.Entry(position, width=6, textvariable=self.pos_x).grid(row=1, column=2, padx=4)
        ttk.Label(position, text="Y").grid(row=1, column=3)
        ttk.Entry(position, width=6, textvariable=self.pos_y).grid(row=1, column=4, padx=4)
        self.pick_btn = ttk.Button(position, text="Elegir ubicación", command=self._pick_location)
        self.pick_btn.grid(row=1, column=5, padx=8)

        # Controles
        controls = ttk.Frame(main)
        controls.grid(row=3, column=0, columnspan=2, sticky="ew", **pad)
        controls.columnconfigure((0, 1), weight=1)
        self.start_btn = ttk.Button(controls, text=f"Iniciar ({HOTKEY_LABEL})", command=self.start)
        self.start_btn.grid(row=0, column=0, sticky="ew", padx=(0, 4), ipady=6)
        self.stop_btn = ttk.Button(controls, text=f"Detener ({HOTKEY_LABEL})", command=self.stop, state="disabled")
        self.stop_btn.grid(row=0, column=1, sticky="ew", padx=(4, 0), ipady=6)

        self.status = tk.StringVar(value=f"Listo. Pulsa {HOTKEY_LABEL} para iniciar o detener.")
        ttk.Label(main, textvariable=self.status, foreground="#555").grid(
            row=4, column=0, columnspan=2, sticky="w", padx=8, pady=(4, 0)
        )

    # ---------- lógica ----------
    def _read_settings(self):
        def to_int(var, name, minimum=0):
            try:
                value = int(var.get())
            except ValueError:
                raise ValueError(f"'{name}' debe ser un número entero.")
            if value < minimum:
                raise ValueError(f"'{name}' debe ser como mínimo {minimum}.")
            return value

        interval = (
            to_int(self.hours, "horas") * 3600
            + to_int(self.minutes, "min") * 60
            + to_int(self.seconds, "seg")
            + to_int(self.millis, "ms") / 1000
        )
        if interval <= 0:
            raise ValueError("El intervalo debe ser mayor que 0 ms.")

        count = None
        if self.repeat_mode.get() == "count":
            count = to_int(self.repeat_count, "veces", 1)

        position = None
        if self.pos_mode.get() == "fixed":
            position = (to_int(self.pos_x, "X"), to_int(self.pos_y, "Y"))

        return {
            "interval": interval,
            "button": BUTTONS[self.button.get()],
            "clicks": CLICK_TYPES[self.click_type.get()],
            "count": count,
            "position": position,
        }

    def start(self):
        if self.worker and self.worker.is_alive():
            return
        try:
            settings = self._read_settings()
        except ValueError as exc:
            messagebox.showerror("Configuración no válida", str(exc), parent=self.root)
            return

        self.stop_event.clear()
        self.worker = threading.Thread(target=self._click_loop, args=(settings,), daemon=True)
        self.worker.start()
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.status.set(f"Haciendo clics... Pulsa {HOTKEY_LABEL} para detener.")

    def stop(self):
        self.stop_event.set()

    def toggle(self):
        if self.worker and self.worker.is_alive():
            self.stop()
        else:
            self.start()

    def _click_loop(self, settings):
        done = 0
        next_time = time.perf_counter()
        while not self.stop_event.is_set():
            if settings["position"] is not None:
                self.mouse.position = settings["position"]
            self.mouse.click(settings["button"], settings["clicks"])
            done += 1
            if done % 10 == 0 or settings["count"]:
                self.root.after(0, self.status.set, f"Clics realizados: {done}")
            if settings["count"] and done >= settings["count"]:
                break
            next_time += settings["interval"]
            # Espera interrumpible: se detiene al instante al pulsar F6.
            self.stop_event.wait(max(0.0, next_time - time.perf_counter()))
        self.root.after(0, self._on_finished, done)

    def _on_finished(self, done):
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.status.set(f"Detenido. Total de clics: {done}. Pulsa {HOTKEY_LABEL} para iniciar.")

    def _pick_location(self):
        if self.picking:
            return
        self.picking = True
        self.pick_btn.config(state="disabled")
        self.status.set("Haz clic en cualquier parte de la pantalla para elegir la ubicación...")
        self.root.iconify()

        def on_click(x, y, _button, pressed):
            if pressed:
                self.root.after(0, self._set_location, int(x), int(y))
                return False  # detiene el listener
            return True

        # Pequeña pausa para que el clic sobre el botón no cuente.
        def start_listener():
            time.sleep(0.3)
            mouse.Listener(on_click=on_click).start()

        threading.Thread(target=start_listener, daemon=True).start()

    def _set_location(self, x, y):
        self.pos_x.set(str(x))
        self.pos_y.set(str(y))
        self.pos_mode.set("fixed")
        self.picking = False
        self.pick_btn.config(state="normal")
        self.root.deiconify()
        self.root.lift()
        self.status.set(f"Ubicación fijada en ({x}, {y}).")

    def _on_key(self, key):
        if key == HOTKEY:
            self.root.after(0, self.toggle)

    def _on_close(self):
        self.stop_event.set()
        self.kb_listener.stop()
        self.root.destroy()


def main():
    root = tk.Tk()
    AutoClicker(root)
    root.mainloop()


if __name__ == "__main__":
    main()
