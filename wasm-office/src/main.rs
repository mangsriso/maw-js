use macroquad::prelude::*;

const BG: Color = Color::new(0.04, 0.04, 0.06, 1.0);
const TEXT_DIM: Color = Color::new(1.0, 1.0, 1.0, 0.35);
const CARD_BG: Color = Color::new(1.0, 1.0, 1.0, 0.03);

fn hex_color(hex: &str) -> Color {
    let hex = hex.trim_start_matches('#');
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(128) as f32 / 255.0;
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(128) as f32 / 255.0;
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(128) as f32 / 255.0;
    Color::new(r, g, b, 1.0)
}

struct Agent {
    name: &'static str,
    display: &'static str,
    color: Color,
    texture: Option<Texture2D>,
}

struct Room {
    label: &'static str,
    color: Color,
    x: f32, y: f32, // center position in world coords
    agents: Vec<usize>, // indices into agents vec
}

#[macroquad::main("Oracle Office")]
async fn main() {
    // Define agents
    let agent_defs: Vec<(&str, &str, &str)> = vec![
        ("neo", "neo", "#64b5f6"),
        ("nexus", "nexus", "#81c784"),
        ("hermes", "hermes", "#ffb74d"),
        ("pulse", "pulse", "#4dd0e1"),
        ("homelab", "homelab", "#90caf9"),
        ("arthur", "arthur", "#ff8a65"),
        ("dustboy", "dustboy", "#a1887f"),
        ("floodboy", "floodboy", "#4dd0e1"),
        ("fireman", "fireman", "#ef5350"),
        ("dustboy-chain", "dustboy chain", "#66bb6a"),
        ("xiaoer", "xiaoer", "#f48fb1"),
        ("maeon", "maeon", "#fdd835"),
        ("mother", "mother", "#ce93d8"),
        ("landing", "landing", "#ff8a65"),
        ("odin", "odin", "#b39ddb"),
        ("volt", "volt", "#fdd835"),
        ("skills-cli", "skills cli", "#4dd0e1"),
        ("oracle-v2", "oracle v2", "#64b5f6"),
    ];

    // Load textures
    let mut agents: Vec<Agent> = Vec::new();
    for (name, display, hex) in &agent_defs {
        let path = format!("/wasm-office/avatars/{}.png", name);
        let tex = load_texture(&path).await.ok();
        if let Some(ref t) = tex {
            t.set_filter(FilterMode::Linear);
        }
        agents.push(Agent {
            name,
            display,
            color: hex_color(hex),
            texture: tex,
        });
    }

    // Define rooms with agent indices (matching Mission Control layout)
    let rooms = vec![
        Room { label: "ORACLES", color: hex_color("#64b5f6"), x: 480.0, y: 320.0,
            agents: vec![0, 1, 2, 3, 4] }, // neo, nexus, hermes, pulse, homelab
        Room { label: "ARRA", color: hex_color("#66bb6a"), x: 720.0, y: 380.0,
            agents: vec![5, 6, 7, 8, 9] }, // arthur, dustboy, floodboy, fireman, dustboy-chain
        Room { label: "HERMES", color: hex_color("#ffb74d"), x: 260.0, y: 400.0,
            agents: vec![2] }, // hermes (also in oracles, shown here as room)
        Room { label: "BREWING", color: hex_color("#795548"), x: 720.0, y: 580.0,
            agents: vec![10, 11] }, // xiaoer, maeon
        Room { label: "WATCHERS", color: hex_color("#ce93d8"), x: 580.0, y: 700.0,
            agents: vec![12, 13, 14] }, // mother, landing, odin
        Room { label: "TOOLS", color: hex_color("#4dd0e1"), x: 340.0, y: 700.0,
            agents: vec![16, 17] }, // skills-cli, oracle-v2
        Room { label: "SOLAR", color: hex_color("#fdd835"), x: 220.0, y: 560.0,
            agents: vec![15] }, // volt
    ];

    let active_agents = vec![0usize, 2, 3, 12]; // neo, hermes, pulse, mother

    let mut time = 0.0f32;
    let mut cam_x = 480.0f32;
    let mut cam_y = 450.0f32;
    let mut zoom = 1.0f32;

    loop {
        let dt = get_frame_time();
        time += dt;
        let sw = screen_width();
        let sh = screen_height();

        // Zoom with mouse wheel
        let (_, wheel_y) = mouse_wheel();
        if wheel_y != 0.0 {
            zoom = (zoom + wheel_y * 0.05).clamp(0.5, 2.5);
        }

        // Pan with mouse drag
        if is_mouse_button_down(MouseButton::Left) {
            let delta = mouse_delta_position();
            cam_x -= delta.x * sw / zoom * 0.5;
            cam_y -= delta.y * sh / zoom * 0.5;
        }

        clear_background(BG);

        // Transform: world to screen
        let to_screen = |wx: f32, wy: f32| -> (f32, f32) {
            let sx = (wx - cam_x) * zoom + sw * 0.5;
            let sy = (wy - cam_y) * zoom + sh * 0.5;
            (sx, sy)
        };

        // Background orbital rings
        let (cx, cy) = to_screen(500.0, 450.0);
        for (r, alpha) in [(150.0, 0.08), (300.0, 0.06), (450.0, 0.04)] {
            draw_circle_lines(cx, cy, r * zoom, 0.5, Color::new(0.5, 0.5, 0.7, alpha));
        }

        // Mission Control center
        draw_circle(cx, cy, 7.0 * zoom, hex_color("#26c6da"));
        draw_circle_lines(cx, cy, 45.0 * zoom, 1.0, Color::new(0.15, 0.78, 0.85, 0.15));
        let mc_text = "MISSION CONTROL";
        let mc_w = measure_text(mc_text, None, (12.0 * zoom) as u16, 1.0).width;
        draw_text(mc_text, cx - mc_w / 2.0, cy + 55.0 * zoom, 12.0 * zoom, TEXT_DIM);

        // Draw rooms
        for room in &rooms {
            let (rx, ry) = to_screen(room.x, room.y);
            let agent_count = room.agents.len();
            let cluster_r = (50.0 + agent_count as f32 * 12.0) * zoom;

            // Room circle
            draw_circle(rx, ry, cluster_r, Color::new(room.color.r, room.color.g, room.color.b, 0.04));
            draw_circle_lines(rx, ry, cluster_r, 1.0, Color::new(room.color.r, room.color.g, room.color.b, 0.15));

            // Room label
            let label_w = measure_text(room.label, None, (14.0 * zoom) as u16, 1.0).width;
            draw_text(
                room.label,
                rx - label_w / 2.0,
                ry - cluster_r - 10.0 * zoom,
                14.0 * zoom,
                room.color,
            );

            // Agent count
            let count_text = format!("{} agent{}", agent_count, if agent_count != 1 { "s" } else { "" });
            let count_w = measure_text(&count_text, None, (10.0 * zoom) as u16, 1.0).width;
            draw_text(
                &count_text,
                rx - count_w / 2.0,
                ry + cluster_r + 16.0 * zoom,
                10.0 * zoom,
                Color::new(room.color.r, room.color.g, room.color.b, 0.6),
            );

            // Draw agents in circular arrangement
            let agent_r = if agent_count == 1 { 0.0 } else {
                (cluster_r - 35.0 * zoom).min(35.0 * zoom + agent_count as f32 * 6.0 * zoom)
            };
            let avatar_size = 48.0 * zoom;

            for (ai, &agent_idx) in room.agents.iter().enumerate() {
                if agent_idx >= agents.len() { continue; }
                let agent = &agents[agent_idx];
                let angle = (ai as f32 / agent_count.max(1) as f32) * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
                let ax = rx + angle.cos() * agent_r;
                let ay = ry + angle.sin() * agent_r;

                let is_active = active_agents.contains(&agent_idx);

                // Active glow
                if is_active {
                    let ga = 0.06 + (time * 2.0 + ai as f32).sin().abs() * 0.04;
                    draw_circle(ax, ay, avatar_size * 0.7, Color::new(agent.color.r, agent.color.g, agent.color.b, ga));
                }

                // Draw avatar texture
                if let Some(tex) = &agent.texture {
                    let half = avatar_size * 0.5;
                    draw_texture_ex(
                        tex,
                        ax - half,
                        ay - half - 4.0 * zoom,
                        WHITE,
                        DrawTextureParams {
                            dest_size: Some(Vec2::new(avatar_size, avatar_size)),
                            ..Default::default()
                        },
                    );
                } else {
                    // Fallback circle
                    draw_circle(ax, ay, avatar_size * 0.35, agent.color);
                    draw_circle_lines(ax, ay, avatar_size * 0.35 + 1.0, 1.5, Color::new(1.0, 1.0, 1.0, 0.3));
                }

                // Name label below avatar
                let name_w = measure_text(agent.display, None, (10.0 * zoom) as u16, 1.0).width;
                draw_text(
                    agent.display,
                    ax - name_w / 2.0,
                    ay + avatar_size * 0.45,
                    10.0 * zoom,
                    if is_active { agent.color } else { Color::new(1.0, 1.0, 1.0, 0.7) },
                );
            }
        }

        // Header bar
        draw_rectangle(0.0, 0.0, sw, 48.0, Color::new(0.06, 0.06, 0.09, 0.95));
        draw_text("M I S S I O N   C O N T R O L", 24.0, 32.0, 20.0, hex_color("#64b5f6"));
        draw_text("oracle fleet overview", 340.0, 32.0, 13.0, TEXT_DIM);

        // Live indicator
        let live_a = 0.5 + (time * 2.0).sin().abs() * 0.5;
        draw_circle(sw - 300.0, 26.0, 4.0, Color::new(0.2, 0.9, 0.4, live_a));
        draw_text("LIVE", sw - 290.0, 32.0, 13.0, Color::new(0.2, 0.9, 0.4, 1.0));

        let total = agents.len();
        let room_count = rooms.len();
        let stats = format!("{}  agents    {}  rooms", total, room_count);
        draw_text(&stats, sw - 220.0, 32.0, 13.0, TEXT_DIM);

        // Bottom status bar
        draw_rectangle(0.0, sh - 32.0, sw, 32.0, Color::new(0.06, 0.06, 0.09, 0.9));
        let active_count = active_agents.len();
        let ready_count = total - active_count;

        // Status dots
        draw_circle(120.0, sh - 16.0, 4.0, hex_color("#fdd835"));
        draw_text(&format!("{} busy", active_count), 130.0, sh - 10.0, 12.0, TEXT_DIM);
        draw_circle(210.0, sh - 16.0, 4.0, hex_color("#4caf50"));
        draw_text(&format!("{} ready", ready_count), 220.0, sh - 10.0, 12.0, TEXT_DIM);

        // Zoom
        let zoom_text = format!("{}%", (zoom * 100.0) as u32);
        let zoom_w = measure_text(&zoom_text, None, 12, 1.0).width;
        draw_text(&zoom_text, sw - zoom_w - 16.0, sh - 10.0, 12.0, TEXT_DIM);

        // FPS
        let fps = format!("{}fps", get_fps());
        draw_text(&fps, 24.0, sh - 10.0, 12.0, TEXT_DIM);

        next_frame().await;
    }
}
