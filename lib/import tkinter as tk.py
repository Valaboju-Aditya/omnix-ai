import tkinter as tk
from tkinter import ttk, messagebox
from datetime import datetime
import math
import random


# ============================================================
# MINIMALIST PYTHON DASHBOARD
# Standard library only — no external dependencies.
# ============================================================

class MinimalDashboard:
    def __init__(self, root):
        self.root = root

        # -----------------------------
        # Window configuration
        # -----------------------------
        self.root.title("NOVA — Minimal Dashboard")
        self.root.geometry("1280x760")
        self.root.minsize(1050, 650)
        self.root.configure(bg="#0d1117")

        # -----------------------------
        # Theme
        # -----------------------------
        self.dark_mode = True

        self.colors = {
            "bg": "#0d1117",
            "panel": "#111820",
            "panel2": "#151d27",
            "border": "#222c38",
            "text": "#f2f5f8",
            "muted": "#84909d",
            "accent": "#6c8cff",
            "accent2": "#8b7cff",
            "green": "#38d39f",
            "yellow": "#f5c451",
            "red": "#ff6b81",
            "white": "#ffffff",
        }

        # -----------------------------
        # Application state
        # -----------------------------
        self.current_page = "Overview"
        self.notifications = 3
        self.tasks = [
            ["Finish dashboard UI", True],
            ["Review Python project", False],
            ["Create GitHub README", False],
            ["Plan next project", False],
        ]

        self.activity = [
            ("Dashboard created", "Just now"),
            ("Python project updated", "12 min ago"),
            ("Task completed", "35 min ago"),
            ("System checked", "1 hour ago"),
        ]

        self.chart_data = [42, 58, 49, 73, 67, 82, 78]

        self.setup_styles()
        self.build_interface()
        self.update_clock()

    # ========================================================
    # STYLING
    # ========================================================

    def setup_styles(self):
        style = ttk.Style()

        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure(
            "TButton",
            font=("Segoe UI", 10),
            padding=(12, 8),
            borderwidth=0
        )

        style.configure(
            "Treeview",
            background=self.colors["panel"],
            foreground=self.colors["text"],
            fieldbackground=self.colors["panel"],
            rowheight=34,
            borderwidth=0
        )

        style.configure(
            "Treeview.Heading",
            background=self.colors["panel2"],
            foreground=self.colors["muted"],
            font=("Segoe UI", 9, "bold"),
            borderwidth=0
        )

    # ========================================================
    # MAIN INTERFACE
    # ========================================================

    def build_interface(self):
        for widget in self.root.winfo_children():
            widget.destroy()

        self.root.configure(bg=self.colors["bg"])

        # Main layout
        self.main = tk.Frame(
            self.root,
            bg=self.colors["bg"]
        )
        self.main.pack(fill="both", expand=True)

        self.create_sidebar()

        self.content = tk.Frame(
            self.main,
            bg=self.colors["bg"]
        )
        self.content.pack(
            side="left",
            fill="both",
            expand=True
        )

        self.create_header()

        self.page_container = tk.Frame(
            self.content,
            bg=self.colors["bg"]
        )
        self.page_container.pack(
            fill="both",
            expand=True,
            padx=30,
            pady=(0, 25)
        )

        self.show_page(self.current_page)

    # ========================================================
    # SIDEBAR
    # ========================================================

    def create_sidebar(self):
        sidebar = tk.Frame(
            self.main,
            width=230,
            bg=self.colors["panel"],
            highlightbackground=self.colors["border"],
            highlightthickness=1
        )
        sidebar.pack(
            side="left",
            fill="y"
        )
        sidebar.pack_propagate(False)

        # Logo
        logo_frame = tk.Frame(
            sidebar,
            bg=self.colors["panel"]
        )
        logo_frame.pack(
            fill="x",
            padx=22,
            pady=(25, 35)
        )

        logo = tk.Label(
            logo_frame,
            text="NOVA",
            font=("Segoe UI", 18, "bold"),
            fg=self.colors["text"],
            bg=self.colors["panel"]
        )
        logo.pack(anchor="w")

        subtitle = tk.Label(
            logo_frame,
            text="PERSONAL SYSTEM",
            font=("Segoe UI", 8),
            fg=self.colors["muted"],
            bg=self.colors["panel"]
        )
        subtitle.pack(anchor="w", pady=(3, 0))

        # Navigation
        navigation = [
            ("Overview", "⌂"),
            ("Analytics", "◈"),
            ("Tasks", "✓"),
            ("Activity", "◌"),
            ("Settings", "⚙"),
        ]

        self.nav_buttons = {}

        for name, icon in navigation:
            button = tk.Button(
                sidebar,
                text=f"  {icon}   {name}",
                anchor="w",
                font=("Segoe UI", 10),
                fg=self.colors["text"],
                bg=self.colors["panel"],
                activeforeground=self.colors["white"],
                activebackground=self.colors["panel2"],
                relief="flat",
                bd=0,
                cursor="hand2",
                padx=18,
                pady=11,
                command=lambda page=name: self.show_page(page)
            )

            button.pack(
                fill="x",
                padx=12,
                pady=2
            )

            self.nav_buttons[name] = button

        # Bottom profile
        bottom = tk.Frame(
            sidebar,
            bg=self.colors["panel"]
        )
        bottom.pack(
            side="bottom",
            fill="x",
            padx=18,
            pady=20
        )

        separator = tk.Frame(
            bottom,
            height=1,
            bg=self.colors["border"]
        )
        separator.pack(fill="x", pady=(0, 15))

        avatar = tk.Label(
            bottom,
            text="U",
            width=3,
            height=1,
            font=("Segoe UI", 11, "bold"),
            fg=self.colors["white"],
            bg=self.colors["accent"]
        )
        avatar.pack(side="left")

        user_frame = tk.Frame(
            bottom,
            bg=self.colors["panel"]
        )
        user_frame.pack(
            side="left",
            padx=10
        )

        tk.Label(
            user_frame,
            text="User",
            font=("Segoe UI", 9, "bold"),
            fg=self.colors["text"],
            bg=self.colors["panel"]
        ).pack(anchor="w")

        tk.Label(
            user_frame,
            text="Local workspace",
            font=("Segoe UI", 8),
            fg=self.colors["muted"],
            bg=self.colors["panel"]
        ).pack(anchor="w")

    # ========================================================
    # HEADER
    # ========================================================

    def create_header(self):
        header = tk.Frame(
            self.content,
            height=85,
            bg=self.colors["bg"]
        )
        header.pack(
            fill="x",
            padx=30
        )
        header.pack_propagate(False)

        left = tk.Frame(
            header,
            bg=self.colors["bg"]
        )
        left.pack(
            side="left",
            fill="y"
        )

        self.page_title = tk.Label(
            left,
            text=self.current_page,
            font=("Segoe UI", 21, "bold"),
            fg=self.colors["text"],
            bg=self.colors["bg"]
        )
        self.page_title.pack(
            anchor="w",
            pady=(18, 0)
        )

        self.page_subtitle = tk.Label(
            left,
            text="Your workspace at a glance",
            font=("Segoe UI", 9),
            fg=self.colors["muted"],
            bg=self.colors["bg"]
        )
        self.page_subtitle.pack(
            anchor="w"
        )

        right = tk.Frame(
            header,
            bg=self.colors["bg"]
        )
        right.pack(
            side="right",
            fill="y"
        )

        self.clock = tk.Label(
            right,
            text="",
            font=("Segoe UI", 10),
            fg=self.colors["muted"],
            bg=self.colors["bg"]
        )
        self.clock.pack(
            side="left",
            padx=(0, 18)
        )

        theme_button = tk.Button(
            right,
            text="☾",
            font=("Segoe UI", 12),
            fg=self.colors["text"],
            bg=self.colors["panel"],
            activebackground=self.colors["panel2"],
            activeforeground=self.colors["white"],
            relief="flat",
            bd=0,
            width=3,
            cursor="hand2",
            command=self.toggle_theme
        )
        theme_button.pack(side="left")

    # ========================================================
    # PAGE ROUTER
    # ========================================================

    def show_page(self, page):
        self.current_page = page

        for widget in self.page_container.winfo_children():
            widget.destroy()

        for name, button in self.nav_buttons.items():
            if name == page:
                button.configure(
                    bg=self.colors["panel2"],
                    fg=self.colors["white"]
                )
            else:
                button.configure(
                    bg=self.colors["panel"],
                    fg=self.colors["text"]
                )

        self.page_title.configure(text=page)

        subtitles = {
            "Overview": "Your workspace at a glance",
            "Analytics": "Understand your recent activity",
            "Tasks": "Keep your work organized",
            "Activity": "Recent events and updates",
            "Settings": "Customize your workspace",
        }

        self.page_subtitle.configure(
            text=subtitles.get(page, "")
        )

        if page == "Overview":
            self.build_overview()

        elif page == "Analytics":
            self.build_analytics()

        elif page == "Tasks":
            self.build_tasks()

        elif page == "Activity":
            self.build_activity()

        elif page == "Settings":
            self.build_settings()

    # ========================================================
    # OVERVIEW
    # ========================================================

    def build_overview(self):
        container = tk.Frame(
            self.page_container,
            bg=self.colors["bg"]
        )
        container.pack(
            fill="both",
            expand=True
        )

        # Cards
        cards = tk.Frame(
            container,
            bg=self.colors["bg"]
        )
        cards.pack(
            fill="x",
            pady=(0, 20)
        )

        stats = [
            ("Projects", "12", "+3 this month", self.colors["accent"]),
            ("Tasks", "28", "64% completed", self.colors["green"]),
            ("Focus time", "18.4h", "+12% this week", self.colors["accent2"]),
            ("Productivity", "87%", "Excellent", self.colors["yellow"]),
        ]

        for i, (title, value, detail, color) in enumerate(stats):
            cards.columnconfigure(i, weight=1)

            card = self.create_card(cards)
            card.grid(
                row=0,
                column=i,
                sticky="nsew",
                padx=(0 if i == 0 else 7, 7 if i < 3 else 0)
            )

            tk.Label(
                card,
                text=title.upper(),
                font=("Segoe UI", 8, "bold"),
                fg=self.colors["muted"],
                bg=self.colors["panel"]
            ).pack(
                anchor="w",
                padx=18,
                pady=(17, 5)
            )

            tk.Label(
                card,
                text=value,
                font=("Segoe UI", 23, "bold"),
                fg=self.colors["text"],
                bg=self.colors["panel"]
            ).pack(
                anchor="w",
                padx=18
            )

            tk.Label(
                card,
                text=detail,
                font=("Segoe UI", 8),
                fg=color,
                bg=self.colors["panel"]
            ).pack(
                anchor="w",
                padx=18,
                pady=(3, 16)
            )

        # Lower area
        lower = tk.Frame(
            container,
            bg=self.colors["bg"]
        )
        lower.pack(
            fill="both",
            expand=True
        )

        lower.columnconfigure(0, weight=3)
        lower.columnconfigure(1, weight=2)
        lower.rowconfigure(0, weight=1)

        chart_card = self.create_card(lower)
        chart_card.grid(
            row=0,
            column=0,
            sticky="nsew",
            padx=(0, 10)
        )

        tk.Label(
            chart_card,
            text="Weekly activity",
            font=("Segoe UI", 12, "bold"),
            fg=self.colors["text"],
            bg=self.colors["panel"]
        ).pack(
            anchor="w",
            padx=18,
            pady=(17, 2)
        )

        tk.Label(
            chart_card,
            text="Activity level over the last seven days",
            font=("Segoe UI", 8),
            fg=self.colors["muted"],
            bg=self.colors["panel"]
        ).pack(
            anchor="w",
            padx=18
        )

        chart = tk.Canvas(
            chart_card,
            bg=self.colors["panel"],
            highlightthickness=0
        )
        chart.pack(
            fill="both",
            expand=True,
            padx=18,
            pady=15
        )

        chart.bind(
            "<Configure>",
            lambda event: self.draw_chart(chart)
        )

        activity_card = self.create_card(lower)
        activity_card.grid(
            row=0,
            column=1,
            sticky="nsew"
        )

        tk.Label(
            activity_card,
            text="Recent activity",
            font=("Segoe UI", 12, "bold"),
            fg=self.colors["text"],
            bg=self.colors["panel"]
        ).pack(
            anchor="w",
            padx=18,
            pady=(17, 2)
        )

        tk.Label(
            activity_card,
            text="Latest workspace events",
            font=("Segoe UI", 8),
            fg=self.colors["muted"],
            bg=self.colors["panel"]
        ).pack(
            anchor="w",
            padx=18,
            pady=(0, 10)
        )

        for title, time in self.activity:
            row = tk.Frame(
                activity_card,
                bg=self.colors["panel"]
            )
            row.pack(
                fill="x",
                padx=18,
                pady=7
            )

            dot = tk.Canvas(
                row,
                width=8,
                height=8,
                bg=self.colors["panel"],
                highlightthickness=0
            )
            dot.pack(side="left", padx=(0, 10))

            dot.create_oval(
                1, 1, 7, 7,
                fill=self.colors["accent"],
                outline=""
            )

            text_frame = tk.Frame(
                row,
                bg=self.colors["panel"]
            )
            text_frame.pack(
                side="left",
                fill="x",
                expand=True
            )

            tk.Label(
                text_frame,
                text=title,
                font=("Segoe UI", 9),
                fg=self.colors["text"],
                bg=self.colors["panel"]
            ).pack(anchor="w")

            tk.Label(
                text_frame,
                text=time,
                font=("Segoe UI", 8),
                fg=self.colors["muted"],
                bg=self.colors["panel"]
            ).pack(anchor="w")

    # ========================================================
    # CHART
    # ========================================================

    def draw_chart(self, canvas):
        canvas.delete("all")

        width = max(canvas.winfo_width(), 100)
        height = max(canvas.winfo_height(), 100)

        padding_left = 15
        padding_right = 15
        padding_top = 20
        padding_bottom = 25

        graph_width = width - padding_left - padding_right
        graph_height = height - padding_top - padding_bottom

        # Grid
        for i in range(5):
            y = padding_top + (graph_height / 4) * i

            canvas.create_line(
                padding_left,
                y,
                width - padding_right,
                y,
                fill=self.colors["border"]
            )

        max_value = max(self.chart_data)
        min_value = 0

        points = []

        for i, value in enumerate(self.chart_data):
            x = (
                padding_left
                + i * graph_width / (len(self.chart_data) - 1)
            )

            normalized = (
                (value - min_value)
                / (max_value - min_value)
            )

            y = (
                padding_top
                + graph_height
                - normalized * graph_height
            )

            points.append((x, y))

        # Area
        polygon = []

        for x, y in points:
            polygon.extend([x, y])

        polygon.extend([
            points[-1][0],
            padding_top + graph_height,
            points[0][0],
            padding_top + graph_height
        ])

        canvas.create_polygon(
            polygon,
            fill="#19223a",
            outline=""
        )

        # Line
        canvas.create_line(
            points,
            fill=self.colors["accent"],
            width=3,
            smooth=True
        )

        labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

        for i, (x, y) in enumerate(points):
            canvas.create_oval(
                x - 4,
                y - 4,
                x + 4,
                y + 4,
                fill=self.colors["accent"],
                outline=self.colors["panel"],
                width=2
            )

            canvas.create_text(
                x,
                height - 8,
                text=labels[i],
                fill=self.colors["muted"],
                font=("Segoe UI", 8)
            )

    # ========================================================
    # ANALYTICS
    # ========================================================

    def build_analytics(self):
        container = tk.Frame(
            self.page_container,
            bg=self.colors["bg"]
        )
        container.pack(
            fill="both",
            expand=True
        )

        title = tk.Label(
            container,
            text="Performance overview",
            font=("Segoe UI", 15, "bold"),
            fg=self.colors["text"],
            bg=self.colors["bg"]
        )
        title.pack(anchor="w", pady=(5, 15))

        analytics_card = self.create_card(container)
        analytics_card.pack(
            fill="both",
            expand=True
        )

        canvas = tk.Canvas(
            analytics_card,
            bg=self.colors["panel"],
            highlightthickness=0
        )
        canvas.pack(
            fill="both",
            expand=True,
            padx=20,
            pady=20
        )

        canvas.bind(
            "<Configure>",
            lambda event: self.draw_large_chart(canvas)
        )

    def draw_large_chart(self, canvas):
        canvas.delete("all")

        width = max(canvas.winfo_width(), 200)
        height = max(canvas.winfo_height(), 200)

        left = 55
        right = 30
        top = 30
        bottom = 45

        gw = width - left - right
        gh = height - top - bottom

        data = [
            35, 48, 44, 60, 52,
            67, 61, 74, 69, 82,
            76, 91
        ]

        # Horizontal grid
        for i in range(6):
            y = top + gh * i / 5

            canvas.create_line(
                left,
                y,
                width - right,
                y,
                fill=self.colors["border"]
            )

            value = 100 - i * 20

            canvas.create_text(
                left - 12,
                y,
                text=str(value),
                fill=self.colors["muted"],
                font=("Segoe UI", 8)
            )

        points = []

        for i, value in enumerate(data):
            x = left + gw * i / (len(data) - 1)
            y = top + gh - (value / 100) * gh
            points.append((x, y))

        canvas.create_line(
            points,
            fill=self.colors["accent"],
            width=4,
            smooth=True
        )

        for x, y in points:
            canvas.create_oval(
                x - 4,
                y - 4,
                x + 4,
                y + 4,
                fill=self.colors["accent"],
                outline=self.colors["panel"],
                width=2
            )

        months = [
            "Jan", "Feb", "Mar", "Apr",
            "May", "Jun", "Jul", "Aug",
            "Sep", "Oct", "Nov", "Dec"
        ]

        for i, month in enumerate(months):
            x = left + gw * i / 11

            canvas.create_text(
                x,
                height - 18,
                text=month,
                fill=self.colors["muted"],
                font=("Segoe UI", 8)
            )

    # ========================================================
    # TASKS
    # ========================================================

    def build_tasks(self):
        container = tk.Frame(
            self.page_container,
            bg=self.colors["bg"]
        )
        container.pack(
            fill="both",
            expand=True
        )

        top = tk.Frame(
            container,
            bg=self.colors["bg"]
        )
        top.pack(
            fill="x",
            pady=(5, 15)
        )

        tk.Label(
            top,
            text="Your tasks",
            font=("Segoe UI", 15, "bold"),
            fg=self.colors["text"],
            bg=self.colors["bg"]
        ).pack(side="left")

        tk.Button(
            top,
            text="+ New task",
            font=("Segoe UI", 9, "bold"),
            fg=self.colors["white"],
            bg=self.colors["accent"],
            activebackground=self.colors["accent2"],
            activeforeground=self.colors["white"],
            relief="flat",
            bd=0,
            padx=15,
            pady=8,
            cursor="hand2",
            command=self.add_task
        ).pack(side="right")

        task_card = self.create_card(container)
        task_card.pack(
            fill="both",
            expand=True
        )

        for index, (task, completed) in enumerate(self.tasks):
            row = tk.Frame(
                task_card,
                bg=self.colors["panel"]
            )
            row.pack(
                fill="x",
                padx=18,
                pady=4
            )

            variable = tk.BooleanVar(value=completed)

            checkbox = tk.Checkbutton(
                row,
                variable=variable,
                command=lambda i=index, v=variable:
                self.toggle_task(i, v),
                bg=self.colors["panel"],
                activebackground=self.colors["panel"],
                selectcolor=self.colors["panel"],
                relief="flat",
                bd=0
            )
            checkbox.pack(side="left")

            label = tk.Label(
                row,
                text=task,
                font=("Segoe UI", 10),
                fg=(
                    self.colors["muted"]
                    if completed
                    else self.colors["text"]
                ),
                bg=self.colors["panel"]
            )
            label.pack(
                side="left",
                padx=8,
                pady=12
            )

    def toggle_task(self, index, variable):
        self.tasks[index][1] = variable.get()

        if variable.get():
            self.activity.insert(
                0,
                ("Task completed", "Just now")
            )

        self.show_page("Tasks")

    def add_task(self):
        dialog = tk.Toplevel(self.root)
        dialog.title("New task")
        dialog.geometry("400x180")
        dialog.resizable(False, False)
        dialog.configure(bg=self.colors["panel"])
        dialog.transient(self.root)
        dialog.grab_set()

        tk.Label(
            dialog,
            text="Create a task",
            font=("Segoe UI", 14, "bold"),
            fg=self.colors["text"],
            bg=self.colors["panel"]
        ).pack(
            anchor="w",
            padx=25,
            pady=(20, 10)
        )

        entry = tk.Entry(
            dialog,
            font=("Segoe UI", 10),
            bg=self.colors["panel2"],
            fg=self.colors["text"],
            insertbackground=self.colors["text"],
            relief="flat"
        )
        entry.pack(
            fill="x",
            padx=25,
            ipady=8
        )
        entry.focus()

        def save():
            text = entry.get().strip()

            if not text:
                messagebox.showwarning(
                    "Empty task",
                    "Please enter a task name.",
                    parent=dialog
                )
                return

            self.tasks.append([text, False])

            self.activity.insert(
                0,
                ("New task created", "Just now")
            )

            dialog.destroy()
            self.show_page("Tasks")

        tk.Button(
            dialog,
            text="Create",
            font=("Segoe UI", 9, "bold"),
            fg=self.colors["white"],
            bg=self.colors["accent"],
            activebackground=self.colors["accent2"],
            relief="flat",
            bd=0,
            padx=18,
            pady=8,
            command=save,
            cursor="hand2"
        ).pack(
            anchor="e",
            padx=25,
            pady=15
        )

    # ========================================================
    # ACTIVITY
    # ========================================================

    def build_activity(self):
        container = tk.Frame(
            self.page_container,
            bg=self.colors["bg"]
        )
        container.pack(
            fill="both",
            expand=True
        )

        card = self.create_card(container)
        card.pack(
            fill="both",
            expand=True
        )

        tk.Label(
            card,
            text="Activity timeline",
            font=("Segoe UI", 15, "bold"),
            fg=self.colors["text"],
            bg=self.colors["panel"]
        ).pack(
            anchor="w",
            padx=25,
            pady=(22, 3)
        )

        tk.Label(
            card,
            text="Everything happening inside your workspace.",
            font=("Segoe UI", 9),
            fg=self.colors["muted"],
            bg=self.colors["panel"]
        ).pack(
            anchor="w",
            padx=25,
            pady=(0, 20)
        )

        for title, time in self.activity:
            row = tk.Frame(
                card,
                bg=self.colors["panel"]
            )
            row.pack(
                fill="x",
                padx=25,
                pady=8
            )

            timeline = tk.Canvas(
                row,
                width=20,
                height=48,
                bg=self.colors["panel"],
                highlightthickness=0
            )
            timeline.pack(side="left")

            timeline.create_oval(
                6,
                8,
                14,
                16,
                fill=self.colors["accent"],
                outline=""
            )

            timeline.create_line(
                10,
                16,
                10,
                48,
                fill=self.colors["border"],
                width=2
            )

            info = tk.Frame(
                row,
                bg=self.colors["panel"]
            )
            info.pack(
                side="left",
                padx=12
            )

            tk.Label(
                info,
                text=title,
                font=("Segoe UI", 10, "bold"),
                fg=self.colors["text"],
                bg=self.colors["panel"]
            ).pack(anchor="w")

            tk.Label(
                info,
                text=time,
                font=("Segoe UI", 8),
                fg=self.colors["muted"],
                bg=self.colors["panel"]
            ).pack(anchor="w")

    # ========================================================
    # SETTINGS
    # ========================================================

    def build_settings(self):
        container = tk.Frame(
            self.page_container,
            bg=self.colors["bg"]
        )
        container.pack(
            fill="both",
            expand=True
        )

        card = self.create_card(container)
        card.pack(
            fill="x",
            pady=(5, 15)
        )

        tk.Label(
            card,
            text="Appearance",
            font=("Segoe UI", 13, "bold"),
            fg=self.colors["text"],
            bg=self.colors["panel"]
        ).pack(
            anchor="w",
            padx=22,
            pady=(20, 5)
        )

        tk.Label(
            card,
            text="Customize how NOVA looks and behaves.",
            font=("Segoe UI", 9),
            fg=self.colors["muted"],
            bg=self.colors["panel"]
        ).pack(
            anchor="w",
            padx=22,
            pady=(0, 18)
        )

        theme_row = tk.Frame(
            card,
            bg=self.colors["panel"]
        )
        theme_row.pack(
            fill="x",
            padx=22,
            pady=(0, 20)
        )

        tk.Label(
            theme_row,
            text="Dark mode",
            font=("Segoe UI", 10),
            fg=self.colors["text"],
            bg=self.colors["panel"]
        ).pack(side="left")

        tk.Button(
            theme_row,
            text="Toggle",
            font=("Segoe UI", 9),
            fg=self.colors["text"],
            bg=self.colors["panel2"],
            activebackground=self.colors["border"],
            relief="flat",
            bd=0,
            padx=15,
            pady=6,
            command=self.toggle_theme
        ).pack(side="right")

        info_card = self.create_card(container)
        info_card.pack(
            fill="x"
        )

        tk.Label(
            info_card,
            text="System information",
            font=("Segoe UI", 13, "bold"),
            fg=self.colors["text"],
            bg=self.colors["panel"]
        ).pack(
            anchor="w",
            padx=22,
            pady=(20, 15)
        )

        information = [
            ("Application", "NOVA Dashboard"),
            ("Version", "1.0.0"),
            ("Runtime", "Python / Tkinter"),
            ("Dependencies", "Standard library only"),
        ]

        for label, value in information:
            row = tk.Frame(
                info_card,
                bg=self.colors["panel"]
            )
            row.pack(
                fill="x",
                padx=22,
                pady=5
            )

            tk.Label(
                row,
                text=label,
                font=("Segoe UI", 9),
                fg=self.colors["muted"],
                bg=self.colors["panel"]
            ).pack(side="left")

            tk.Label(
                row,
                text=value,
                font=("Segoe UI", 9, "bold"),
                fg=self.colors["text"],
                bg=self.colors["panel"]
            ).pack(side="right")

    # ========================================================
    # UTILITIES
    # ========================================================

    def create_card(self, parent):
        return tk.Frame(
            parent,
            bg=self.colors["panel"],
            highlightbackground=self.colors["border"],
            highlightthickness=1
        )

    def update_clock(self):
        now = datetime.now()

        self.clock.configure(
            text=now.strftime("%A, %d %B  •  %I:%M %p")
        )

        self.root.after(
            1000,
            self.update_clock
        )

    # ========================================================
    # THEME
    # ========================================================

    def toggle_theme(self):
        self.dark_mode = not self.dark_mode

        if self.dark_mode:
            self.colors.update({
                "bg": "#0d1117",
                "panel": "#111820",
                "panel2": "#151d27",
                "border": "#222c38",
                "text": "#f2f5f8",
                "muted": "#84909d",
            })
        else:
            self.colors.update({
                "bg": "#f4f6f8",
                "panel": "#ffffff",
                "panel2": "#edf1f5",
                "border": "#dfe4ea",
                "text": "#17202a",
                "muted": "#697586",
            })

        self.build_interface()


# ============================================================
# START APPLICATION
# ============================================================

def main():
    root = tk.Tk()

    # Better rendering on Windows where possible
    try:
        root.tk.call("tk", "scaling", 1.15)
    except tk.TclError:
        pass

    app = MinimalDashboard(root)

    root.mainloop()


if __name__ == "__main__":
    main()
