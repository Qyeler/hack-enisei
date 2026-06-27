#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <queue>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using std::string;

struct Boat {
    double base_l_per_km = 0.8;
    double tank_l = 370.0;
    double reserve_frac_tank = 0.2;
    double dry_mass_kg = 1450.0;
    double payload_kg = 650.0;
    double hull_length_m = 6.9;
    double max_engine_hp = 280.0;
    double propulsive_efficiency = 0.58;
    double bsfc_g_per_kwh = 305.0;
    double fuel_density_kg_l = 0.74;
    double resistance_area_m2 = 1.45;
    double air_drag_area_m2 = 1.1;
    double displacement_cd = 0.42;
    double planing_cd = 0.18;
    double surface_mu = 0.105;
    double planing_froude_on = 0.75;
    double planing_froude_full = 1.0;
    double min_planing_speed_kmh = 34.0;
};

struct Config {
    string name;
    double k_load = 1.0;
    bool allow_hard = false;
};

struct Surface {
    string id;
    string label;
    double speed_kmh = 1.0;
    double k_surf = 1.0;
    double risk = 1.0;
    bool planing = false;
    bool hard = false;
};

struct Mode {
    string name;
    string obj;
    double k_mode = 1.0;
    string desc;
};

struct ModeWeights {
    double distance = 0.2;
    double time = 0.2;
    double fuel = 0.2;
    double risk = 0.2;
    double planing_penalty = 0.1;
    double hard_penalty = 0.25;
};

struct Edge {
    string from;
    string to;
    double km = 0.0;
    string surface;
    string source = "unknown";
};

struct NodeCoord {
    double lat = 0.0;
    double lon = 0.0;
};

struct SpeedAdvice {
    double recommended_speed_kmh = 1.0;
    double froude = 0.0;
    double planing_threshold_kmh = 0.0;
    string pace = "normal";
    string pace_label = "умеренно";
    string motion_state = "displacement";
    string motion_label = "водоизмещающий режим";
    bool narrow_waterway = false;
    string cavitation_risk = "low";
    string cavitation_label = "низкий";
    std::vector<string> notes;
};

struct Scenario {
    string name;
    string area;
    string default_start;
    string default_finish;
    Boat boat;
    std::map<string, Config> configs;
    std::map<string, Surface> surfaces;
    std::map<string, Mode> modes;
    std::unordered_map<string, NodeCoord> node_coords;
    std::vector<Edge> edges;
};

struct Segment {
    Edge edge;
    Surface surface;
    SpeedAdvice speed_advice;
    double time_h = 0.0;
    double fuel_l = 0.0;
    double fuel_l_h = 0.0;
    double fuel_l_per_km = 0.0;
    double resistance_n = 0.0;
    double power_kw = 0.0;
    double total_mass_kg = 0.0;
    double risk_points = 0.0;
    double distance_component = 0.0;
    double time_component = 0.0;
    double fuel_component = 0.0;
    double risk_component = 0.0;
    double planing_penalty = 0.0;
    double hard_penalty = 0.0;
    double cost = 0.0;
};

struct RouteResult {
    bool ok = false;
    string error;
    string start;
    string finish;
    string mode;
    string config;
    std::vector<string> nodes;
    std::vector<Segment> segments;
    double distance_km = 0.0;
    double time_h = 0.0;
    double fuel_l = 0.0;
    double risk_points = 0.0;
    double cost = 0.0;
    double remainder_l = 0.0;
    double reserve_l = 0.0;
    std::vector<string> warnings;
    std::vector<string> route_advice;
};

static std::vector<string> split(const string& line, char delimiter) {
    std::vector<string> parts;
    std::stringstream ss(line);
    string item;
    while (std::getline(ss, item, delimiter)) parts.push_back(item);
    return parts;
}

static double to_double(const string& value, const string& field) {
    try {
        return std::stod(value);
    } catch (...) {
        throw std::runtime_error("Invalid numeric value for " + field + ": " + value);
    }
}

static bool to_bool(const string& value) {
    return value == "1" || value == "true" || value == "yes";
}

static string json_escape(const string& input) {
    std::ostringstream out;
    for (unsigned char c : input) {
        switch (c) {
            case '\\': out << "\\\\"; break;
            case '"': out << "\\\""; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (c < 0x20) {
                    out << "\\u";
                    const char* hex = "0123456789abcdef";
                    out << "00" << hex[(c >> 4) & 0x0f] << hex[c & 0x0f];
                } else {
                    out << c;
                }
        }
    }
    return out.str();
}

static Scenario load_scenario(const string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("Cannot open scenario file: " + path);

    Scenario scenario;
    string line;
    int line_no = 0;
    while (std::getline(in, line)) {
        line_no++;
        if (line.empty() || line[0] == '#') continue;
        auto p = split(line, '|');
        if (p.empty()) continue;
        const string& type = p[0];
        try {
            if (type == "SCENARIO" && p.size() >= 5) {
                scenario.name = p[1];
                scenario.area = p[2];
                scenario.default_start = p[3];
                scenario.default_finish = p[4];
            } else if (type == "BOAT" && p.size() >= 4) {
                scenario.boat.base_l_per_km = to_double(p[1], "base_l_per_km");
                scenario.boat.tank_l = to_double(p[2], "tank_l");
                scenario.boat.reserve_frac_tank = to_double(p[3], "reserve_frac_tank");
            } else if (type == "CONFIG" && p.size() >= 4) {
                Config cfg;
                cfg.name = p[1];
                cfg.k_load = to_double(p[2], "config.k_load");
                cfg.allow_hard = to_bool(p[3]);
                scenario.configs[cfg.name] = cfg;
            } else if (type == "SURFACE" && p.size() >= 8) {
                Surface surface;
                surface.id = p[1];
                surface.label = p[2];
                surface.speed_kmh = std::max(0.001, to_double(p[3], "surface.speed_kmh"));
                surface.k_surf = to_double(p[4], "surface.k_surf");
                surface.risk = to_double(p[5], "surface.risk");
                surface.planing = to_bool(p[6]);
                surface.hard = to_bool(p[7]);
                scenario.surfaces[surface.id] = surface;
            } else if (type == "MODE" && p.size() >= 5) {
                Mode mode;
                mode.name = p[1];
                mode.obj = p[2];
                mode.k_mode = to_double(p[3], "mode.k_mode");
                mode.desc = p[4];
                scenario.modes[mode.name] = mode;
            } else if (type == "NODE" && p.size() >= 4) {
                NodeCoord coord;
                coord.lat = to_double(p[2], "node.lat");
                coord.lon = to_double(p[3], "node.lon");
                scenario.node_coords[p[1]] = coord;
            } else if (type == "EDGE" && p.size() >= 5) {
                Edge edge;
                edge.from = p[1];
                edge.to = p[2];
                edge.km = to_double(p[3], "edge.km");
                edge.surface = p[4];
                if (p.size() >= 6) edge.source = p[5];
                scenario.edges.push_back(edge);
            }
        } catch (const std::exception& e) {
            throw std::runtime_error("Line " + std::to_string(line_no) + ": " + e.what());
        }
    }
    return scenario;
}

static ModeWeights weights_for_mode(const Mode& mode) {
    ModeWeights weights;
    if (mode.obj == "length") {
        weights.distance = 1.0;
        weights.time = 0.15;
        weights.fuel = 0.10;
        weights.risk = 0.20;
        weights.planing_penalty = 0.08;
        weights.hard_penalty = 0.30;
    } else if (mode.obj == "time") {
        weights.distance = 0.15;
        weights.time = 1.0;
        weights.fuel = 0.20;
        weights.risk = 0.25;
        weights.planing_penalty = 0.15;
        weights.hard_penalty = 0.35;
    } else if (mode.obj == "fuel") {
        weights.distance = 0.20;
        weights.time = 0.25;
        weights.fuel = 1.0;
        weights.risk = 0.30;
        weights.planing_penalty = 0.12;
        weights.hard_penalty = 0.40;
    } else if (mode.obj == "risk") {
        weights.distance = 0.20;
        weights.time = 0.20;
        weights.fuel = 0.30;
        weights.risk = 1.0;
        weights.planing_penalty = 0.20;
        weights.hard_penalty = 0.60;
    }
    return weights;
}

static double haversine_km(const NodeCoord& a, const NodeCoord& b) {
    const double radius_km = 6371.0;
    const double pi = 3.14159265358979323846;
    const double dlat = (b.lat - a.lat) * pi / 180.0;
    const double dlon = (b.lon - a.lon) * pi / 180.0;
    const double lat1 = a.lat * pi / 180.0;
    const double lat2 = b.lat * pi / 180.0;
    const double h = std::sin(dlat / 2.0) * std::sin(dlat / 2.0)
        + std::cos(lat1) * std::cos(lat2) * std::sin(dlon / 2.0) * std::sin(dlon / 2.0);
    return 2.0 * radius_km * std::asin(std::sqrt(h));
}

static double heuristic_cost(const Scenario& scenario, const string& node, const string& finish, const ModeWeights& weights) {
    auto from_it = scenario.node_coords.find(node);
    auto to_it = scenario.node_coords.find(finish);
    if (from_it == scenario.node_coords.end() || to_it == scenario.node_coords.end()) return 0.0;

    double max_speed = 1.0;
    for (const auto& item : scenario.surfaces) {
        max_speed = std::max(max_speed, item.second.speed_kmh);
    }
    const double km = haversine_km(from_it->second, to_it->second);
    const double time_component = ((km / max_speed) * 60.0) / 10.0;
    return weights.distance * km + weights.time * time_component;
}

static bool contains_text(const string& haystack, const string& needle) {
    return haystack.find(needle) != string::npos;
}

static double clamp_value(double value, double low, double high) {
    return std::max(low, std::min(high, value));
}

static double speed_factor_for_mode(const Mode& mode) {
    if (mode.obj == "time") return 1.0;
    if (mode.obj == "length") return 0.9;
    if (mode.obj == "fuel") return 0.78;
    if (mode.obj == "risk") return 0.68;
    return 0.85;
}

static double total_mass_kg(const Boat& boat) {
    return std::max(200.0, boat.dry_mass_kg + boat.payload_kg);
}

static double planing_threshold_kmh(const Boat& boat) {
    const double g = 9.80665;
    const double v_ms = boat.planing_froude_full * std::sqrt(g * std::max(1.0, boat.hull_length_m));
    const double mass_factor = std::sqrt(total_mass_kg(boat) / std::max(boat.dry_mass_kg + 500.0, 1.0));
    return std::max(boat.min_planing_speed_kmh, v_ms * 3.6 * mass_factor);
}

static double froude_number(double speed_kmh, const Boat& boat) {
    const double g = 9.80665;
    const double v_ms = speed_kmh / 3.6;
    return v_ms / std::sqrt(g * std::max(1.0, boat.hull_length_m));
}

static SpeedAdvice build_speed_advice(const Edge& edge, const Surface& surface, const Mode& mode, const Boat& boat) {
    SpeedAdvice advice;
    const bool waterway_line = contains_text(edge.source, "waterway");
    const bool micro_waterbody = contains_text(edge.source, "small_waterbody");
    advice.narrow_waterway = waterway_line || micro_waterbody;
    advice.planing_threshold_kmh = planing_threshold_kmh(boat);

    double speed = surface.speed_kmh * speed_factor_for_mode(mode);
    if (advice.narrow_waterway) {
        speed = std::min(speed, surface.planing ? 22.0 : 12.0);
        advice.notes.push_back("узкая река/протока: снизить скорость и держать запас для маневра");
    }

    if (!surface.planing) {
        speed = std::min(speed, 18.0);
        advice.notes.push_back("поверхность не поддерживает устойчивое глиссирование");
    }
    if (surface.hard) {
        speed = std::min(speed, 10.0);
        advice.notes.push_back("сложная поверхность: идти медленно, без резких ускорений");
    } else if (surface.risk >= 5.0) {
        speed = std::min(speed, 14.0);
        advice.notes.push_back("высокий риск поверхности: нужен осторожный темп");
    } else if (surface.risk >= 4.0) {
        speed = std::min(speed, 18.0);
        advice.notes.push_back("повышенный риск: лучше не разгоняться");
    } else if (surface.k_surf >= 1.35) {
        speed = std::min(speed, 24.0);
        advice.notes.push_back("повышенное сопротивление: держать ровную тягу");
    }

    speed = clamp_value(speed, 5.0, surface.speed_kmh);
    advice.recommended_speed_kmh = speed;
    advice.froude = froude_number(speed, boat);

    if (surface.planing && !advice.narrow_waterway && speed >= advice.planing_threshold_kmh && advice.froude >= boat.planing_froude_full && surface.risk <= 3.0) {
        advice.motion_state = "planing";
        advice.motion_label = "глиссирование";
    } else if (surface.planing && speed >= advice.planing_threshold_kmh * 0.72 && advice.froude >= boat.planing_froude_on && surface.risk <= 3.0) {
        advice.motion_state = "transition";
        advice.motion_label = "переходный режим";
        advice.notes.push_back("скорость ниже уверенного глиссирования: не держать долго пограничный режим");
    } else {
        advice.motion_state = "displacement";
        advice.motion_label = "водоизмещающий режим";
    }

    if (speed <= 14.0 || surface.hard || surface.risk >= 5.0) {
        advice.pace = "slow";
        advice.pace_label = "медленно";
    } else if (speed >= 34.0 && advice.motion_state == "planing") {
        advice.pace = "fast";
        advice.pace_label = "можно быстрее";
    } else {
        advice.pace = "moderate";
        advice.pace_label = "умеренно";
    }

    if (surface.hard || surface.k_surf >= 1.6 || surface.risk >= 5.0 || (!surface.planing && speed <= 14.0)) {
        advice.cavitation_risk = "elevated";
        advice.cavitation_label = "повышенный";
        advice.notes.push_back("риск кавитации/срыва потока/перегрузки винта: избегать резкого газа");
    } else if (surface.k_surf >= 1.35 || surface.risk >= 4.0 || advice.motion_state == "transition") {
        advice.cavitation_risk = "medium";
        advice.cavitation_label = "средний";
        advice.notes.push_back("следить за оборотами и тягой, не провоцировать срыв потока");
    }

    if (advice.notes.empty()) {
        advice.notes.push_back("участок допускает штатный темп по выбранному режиму");
    }
    return advice;
}

static double motion_drag_cd(const SpeedAdvice& advice, const Boat& boat) {
    if (advice.motion_state == "planing") return boat.planing_cd;
    if (advice.motion_state == "transition") return (boat.displacement_cd + boat.planing_cd) * 0.5;
    return boat.displacement_cd;
}

static double hump_factor(const SpeedAdvice& advice, const Boat& boat) {
    if (advice.motion_state == "planing") return 0.72;
    if (advice.motion_state == "transition") return 1.18;
    const double normalized = advice.froude / std::max(boat.planing_froude_on, 0.1);
    return 1.0 + 0.42 * std::pow(std::max(0.0, normalized), 4.0);
}

static double calculate_resistance_n(const Boat& boat, const Surface& surface, const Config& config, const SpeedAdvice& advice) {
    const double air_density = 1.225;
    const double v_ms = advice.recommended_speed_kmh / 3.6;
    const double mass = total_mass_kg(boat) * config.k_load;
    const double dynamic_resistance = 0.5 * air_density * boat.resistance_area_m2 * motion_drag_cd(advice, boat) * v_ms * v_ms;
    const double air_drag = 0.5 * air_density * boat.air_drag_area_m2 * 0.9 * v_ms * v_ms;
    const double surface_drag = mass * 9.80665 * boat.surface_mu * std::max(0.55, surface.k_surf);
    return (dynamic_resistance * hump_factor(advice, boat) + air_drag + surface_drag) * std::max(0.65, surface.k_surf);
}

static double calculate_power_kw(double resistance_n, const SpeedAdvice& advice, const Boat& boat) {
    const double v_ms = advice.recommended_speed_kmh / 3.6;
    const double prop_eff = clamp_value(boat.propulsive_efficiency, 0.2, 0.9);
    const double required_kw = resistance_n * v_ms / (1000.0 * prop_eff);
    const double engine_limit_kw = boat.max_engine_hp * 0.7457;
    return clamp_value(required_kw, 2.0, engine_limit_kw);
}

static double calculate_fuel_l_h(double power_kw, const Boat& boat, const Mode& mode) {
    const double density = std::max(0.5, boat.fuel_density_kg_l);
    const double bsfc = std::max(120.0, boat.bsfc_g_per_kwh);
    return power_kw * bsfc * mode.k_mode / (density * 1000.0);
}

static Segment score_edge(const Edge& edge, const Surface& surface, const Config& config, const Mode& mode, const Boat& boat) {
    Segment segment;
    segment.edge = edge;
    segment.surface = surface;
    segment.speed_advice = build_speed_advice(edge, surface, mode, boat);
    segment.time_h = edge.km / segment.speed_advice.recommended_speed_kmh;
    segment.total_mass_kg = total_mass_kg(boat) * config.k_load;
    segment.resistance_n = calculate_resistance_n(boat, surface, config, segment.speed_advice);
    segment.power_kw = calculate_power_kw(segment.resistance_n, segment.speed_advice, boat);
    segment.fuel_l_h = calculate_fuel_l_h(segment.power_kw, boat, mode);
    const double fallback_fuel = edge.km * boat.base_l_per_km * surface.k_surf * config.k_load * mode.k_mode;
    segment.fuel_l = std::max(fallback_fuel * 0.08, segment.fuel_l_h * segment.time_h);
    segment.fuel_l_per_km = segment.fuel_l / std::max(edge.km, 0.001);
    const double speed_risk = 1.0 + 0.22 * std::pow(segment.speed_advice.recommended_speed_kmh / std::max(surface.speed_kmh, 1.0), 2.0);
    const double narrow_risk = segment.speed_advice.narrow_waterway ? 1.12 : 1.0;
    segment.risk_points = edge.km * surface.risk * speed_risk * narrow_risk;

    const ModeWeights weights = weights_for_mode(mode);
    segment.distance_component = edge.km;
    segment.time_component = (segment.time_h * 60.0) / 10.0;
    segment.fuel_component = segment.fuel_l / 10.0;
    segment.risk_component = segment.risk_points / 5.0;
    segment.planing_penalty = surface.planing ? 0.0 : edge.km;
    segment.hard_penalty = surface.hard ? edge.km : 0.0;
    segment.cost =
        weights.distance * segment.distance_component +
        weights.time * segment.time_component +
        weights.fuel * segment.fuel_component +
        weights.risk * segment.risk_component +
        weights.planing_penalty * segment.planing_penalty +
        weights.hard_penalty * segment.hard_penalty;
    return segment;
}

static RouteResult calculate_route(const Scenario& scenario, const string& start, const string& finish, const string& config_name, const string& mode_name) {
    RouteResult result;
    result.start = start;
    result.finish = finish;
    result.config = config_name;
    result.mode = mode_name;
    result.reserve_l = scenario.boat.tank_l * scenario.boat.reserve_frac_tank;

    auto cfg_it = scenario.configs.find(config_name);
    if (cfg_it == scenario.configs.end()) {
        result.error = "Unknown config: " + config_name;
        return result;
    }
    auto mode_it = scenario.modes.find(mode_name);
    if (mode_it == scenario.modes.end()) {
        result.error = "Unknown mode: " + mode_name;
        return result;
    }
    const Config& config = cfg_it->second;
    const Mode& mode = mode_it->second;

    std::set<string> node_set;
    for (const auto& edge : scenario.edges) {
        node_set.insert(edge.from);
        node_set.insert(edge.to);
    }
    if (!node_set.count(start)) {
        result.error = "Unknown start node: " + start;
        return result;
    }
    if (!node_set.count(finish)) {
        result.error = "Unknown finish node: " + finish;
        return result;
    }

    std::unordered_map<string, std::vector<Segment>> graph;
    for (const auto& edge : scenario.edges) {
        auto surface_it = scenario.surfaces.find(edge.surface);
        if (surface_it == scenario.surfaces.end()) continue;
        const Surface& surface = surface_it->second;
        if (surface.hard && !config.allow_hard) continue;
        Segment forward = score_edge(edge, surface, config, mode, scenario.boat);
        graph[edge.from].push_back(forward);

        Edge reverse = edge;
        std::swap(reverse.from, reverse.to);
        Segment backward = score_edge(reverse, surface, config, mode, scenario.boat);
        graph[reverse.from].push_back(backward);
    }

    const double INF = std::numeric_limits<double>::infinity();
    std::unordered_map<string, double> dist;
    std::unordered_map<string, string> prev_node;
    std::unordered_map<string, Segment> prev_segment;
    for (const auto& node : node_set) dist[node] = INF;
    dist[start] = 0.0;
    const ModeWeights active_weights = weights_for_mode(mode);

    using QueueItem = std::pair<double, string>;
    std::priority_queue<QueueItem, std::vector<QueueItem>, std::greater<QueueItem>> queue;
    queue.push({heuristic_cost(scenario, start, finish, active_weights), start});
    std::unordered_set<string> closed;

    while (!queue.empty()) {
        auto [priority, node] = queue.top();
        queue.pop();
        (void)priority;
        if (closed.count(node)) continue;
        closed.insert(node);
        if (node == finish) break;
        for (const auto& segment : graph[node]) {
            const string& next = segment.edge.to;
            if (closed.count(next)) continue;
            double candidate = dist[node] + segment.cost;
            if (candidate < dist[next]) {
                dist[next] = candidate;
                prev_node[next] = node;
                prev_segment[next] = segment;
                queue.push({candidate + heuristic_cost(scenario, next, finish, active_weights), next});
            }
        }
    }

    if (!std::isfinite(dist[finish])) {
        result.error = "Route is not available for config: " + config_name;
        if (!config.allow_hard) {
            result.warnings.push_back("В этой конфигурации запрещены сложные участки: камни/болото.");
        }
        return result;
    }

    std::vector<Segment> reversed_segments;
    string cursor = finish;
    result.nodes.push_back(cursor);
    while (cursor != start) {
        auto prev_it = prev_node.find(cursor);
        if (prev_it == prev_node.end()) {
            result.error = "Internal route reconstruction error.";
            return result;
        }
        reversed_segments.push_back(prev_segment[cursor]);
        cursor = prev_it->second;
        result.nodes.push_back(cursor);
    }
    std::reverse(result.nodes.begin(), result.nodes.end());
    std::reverse(reversed_segments.begin(), reversed_segments.end());
    result.segments = reversed_segments;

    std::set<string> unique_warnings;
    std::set<string> unique_advice;
    for (const auto& segment : result.segments) {
        result.distance_km += segment.edge.km;
        result.time_h += segment.time_h;
        result.fuel_l += segment.fuel_l;
        result.risk_points += segment.risk_points;
        result.cost += segment.cost;
        if (!segment.surface.planing) {
            unique_warnings.insert("Есть участок без глиссирования: " + segment.surface.label + ".");
        }
        if (segment.surface.hard) {
            unique_warnings.insert("Маршрут использует сложную поверхность: " + segment.surface.label + ".");
        }
        if (segment.speed_advice.narrow_waterway) {
            unique_advice.insert("На узких реках и протоках скорость ограничена рекомендацией до " + std::to_string((int)std::round(segment.speed_advice.recommended_speed_kmh)) + " км/ч.");
        }
        if (segment.speed_advice.cavitation_risk != "low") {
            unique_advice.insert("На вязких/рисковых участках избегать резкого газа: возможны кавитация, срыв потока или перегрузка винта.");
        }
        if (segment.speed_advice.motion_state == "planing") {
            unique_advice.insert("На открытой воде/льду с низким риском допускается глиссирование по выбранному режиму.");
        }
    }
    result.warnings.insert(result.warnings.end(), unique_warnings.begin(), unique_warnings.end());
    result.route_advice.insert(result.route_advice.end(), unique_advice.begin(), unique_advice.end());
    result.remainder_l = scenario.boat.tank_l - result.fuel_l;
    if (result.remainder_l < result.reserve_l) {
        result.warnings.push_back("Остаток топлива ниже безопасного резерва.");
    }
    if (result.warnings.empty()) {
        result.warnings.push_back("Критичных предупреждений по расчетной модели нет.");
    }
    result.ok = true;
    return result;
}

static void write_string_array(std::ostream& out, const std::vector<string>& values) {
    out << "[";
    for (size_t i = 0; i < values.size(); ++i) {
        if (i) out << ",";
        out << "\"" << json_escape(values[i]) << "\"";
    }
    out << "]";
}

static void write_mode_weights_json(std::ostream& out, const ModeWeights& weights) {
    out << "{";
    out << "\"distance\":" << weights.distance;
    out << ",\"time\":" << weights.time;
    out << ",\"fuel\":" << weights.fuel;
    out << ",\"risk\":" << weights.risk;
    out << ",\"planing_penalty\":" << weights.planing_penalty;
    out << ",\"hard_penalty\":" << weights.hard_penalty;
    out << "}";
}

static void write_result_json(std::ostream& out, const Scenario& scenario, const RouteResult& result) {
    out.setf(std::ios::fixed);
    out.precision(3);
    out << "{";
    out << "\"ok\":" << (result.ok ? "true" : "false");
    out << ",\"scenario\":{\"name\":\"" << json_escape(scenario.name)
        << "\",\"area\":\"" << json_escape(scenario.area) << "\"}";
    out << ",\"request\":{\"start\":\"" << json_escape(result.start)
        << "\",\"finish\":\"" << json_escape(result.finish)
        << "\",\"mode\":\"" << json_escape(result.mode)
        << "\",\"config\":\"" << json_escape(result.config) << "\"}";

    auto cfg_it = scenario.configs.find(result.config);
    auto mode_it = scenario.modes.find(result.mode);
    const Config* cfg = cfg_it == scenario.configs.end() ? nullptr : &cfg_it->second;
    const Mode* mode = mode_it == scenario.modes.end() ? nullptr : &mode_it->second;
    out << ",\"calculation_inputs\":{";
    out << "\"boat\":{\"base_l_per_km\":" << scenario.boat.base_l_per_km
        << ",\"tank_l\":" << scenario.boat.tank_l
        << ",\"reserve_frac_tank\":" << scenario.boat.reserve_frac_tank
        << ",\"dry_mass_kg\":" << scenario.boat.dry_mass_kg
        << ",\"payload_kg\":" << scenario.boat.payload_kg
        << ",\"total_mass_kg\":" << total_mass_kg(scenario.boat)
        << ",\"hull_length_m\":" << scenario.boat.hull_length_m
        << ",\"max_engine_hp\":" << scenario.boat.max_engine_hp
        << ",\"propulsive_efficiency\":" << scenario.boat.propulsive_efficiency
        << ",\"bsfc_g_per_kwh\":" << scenario.boat.bsfc_g_per_kwh
        << ",\"fuel_density_kg_l\":" << scenario.boat.fuel_density_kg_l
        << ",\"resistance_area_m2\":" << scenario.boat.resistance_area_m2
        << ",\"air_drag_area_m2\":" << scenario.boat.air_drag_area_m2
        << ",\"displacement_cd\":" << scenario.boat.displacement_cd
        << ",\"planing_cd\":" << scenario.boat.planing_cd
        << ",\"surface_mu\":" << scenario.boat.surface_mu
        << ",\"planing_froude_on\":" << scenario.boat.planing_froude_on
        << ",\"planing_froude_full\":" << scenario.boat.planing_froude_full
        << ",\"min_planing_speed_kmh\":" << scenario.boat.min_planing_speed_kmh
        << ",\"planing_threshold_kmh\":" << planing_threshold_kmh(scenario.boat)
        << "}";
    if (cfg) {
        out << ",\"config\":{\"name\":\"" << json_escape(cfg->name)
            << "\",\"k_load\":" << cfg->k_load
            << ",\"allow_hard\":" << (cfg->allow_hard ? "true" : "false") << "}";
    }
    if (mode) {
        out << ",\"mode\":{\"name\":\"" << json_escape(mode->name)
            << "\",\"objective\":\"" << json_escape(mode->obj)
            << "\",\"k_mode\":" << mode->k_mode
            << ",\"desc\":\"" << json_escape(mode->desc)
            << "\",\"weights\":";
        write_mode_weights_json(out, weights_for_mode(*mode));
        out << "}";
    }
    out << ",\"formulas\":{";
    out << "\"time_segment\":\"t_h = km / V_rec_kmh\"";
    out << ",\"froude\":\"Fn = (V_rec_kmh / 3.6) / sqrt(g * hull_length_m)\"";
    out << ",\"planing_threshold\":\"V_planing = max(V_min, 3.6 * Fn_full * sqrt(g * L) * sqrt(m / max(m_dry + 500, 1)))\"";
    out << ",\"resistance\":\"R_dyn = 0.5*rho_air*A_res*Cd*v^2; R_air = 0.5*rho_air*A_air*0.9*v^2; R_surf = m_eff*g*mu_surface*max(0.55,k_surf); R = (R_dyn*k_hump + R_air + R_surf)*max(0.65,k_surf)\"";
    out << ",\"power\":\"P = clamp(R * v / (1000 * eta), P_min, P_max)\"";
    out << ",\"fuel_segment\":\"q_fuel = P * BSFC * k_mode / (rho_fuel * 1000); F_seg = max(q_fuel * t_h, 0.08 * fallback)\"";
    out << ",\"fuel_fallback\":\"fallback = km * base_l_per_km * k_surf * k_load * k_mode\"";
    out << ",\"risk_segment\":\"Risk_seg = km * surface_risk * speed_risk * narrow_risk\"";
    out << ",\"reserve_l\":\"reserve_l = tank_l * reserve_frac_tank\"";
    out << ",\"edge_cost\":\"C_edge = w_d*km + w_t*(time_min/10) + w_f*(fuel_l/10) + w_r*(risk_points/5) + penalties\"";
    out << "},\"speed_policy\":{";
    out << "\"base\":\"Базовая скорость берется из типа поверхности, затем корректируется под режим маршрута.\"";
    out << ",\"narrow_waterway\":\"Ребра OSM waterway и малые водоемы считаются узкими: скорость режется до медленного темпа.\"";
    out << ",\"motion_states\":\"Глиссирование разрешается только на низкорисковых широких участках; сложные поверхности переводятся в водоизмещающий режим.\"";
    out << ",\"cavitation_note\":\"Для аэролодки это прикладной флаг кавитации/срыва потока/перегрузки винта, а не точная модель водяного винта.\"";
    out << "}}";

    if (!result.ok) {
        out << ",\"error\":\"" << json_escape(result.error) << "\"";
        out << ",\"warnings\":";
        write_string_array(out, result.warnings);
        out << "}\n";
        return;
    }

    out << ",\"route\":{\"nodes\":";
    write_string_array(out, result.nodes);
    out << ",\"segments\":[";
    for (size_t i = 0; i < result.segments.size(); ++i) {
        const auto& s = result.segments[i];
        if (i) out << ",";
        out << "{";
        out << "\"from\":\"" << json_escape(s.edge.from) << "\"";
        out << ",\"to\":\"" << json_escape(s.edge.to) << "\"";
        out << ",\"km\":" << s.edge.km;
        out << ",\"surface\":\"" << json_escape(s.edge.surface) << "\"";
        out << ",\"edge_source\":\"" << json_escape(s.edge.source) << "\"";
        out << ",\"surface_label\":\"" << json_escape(s.surface.label) << "\"";
        out << ",\"speed_kmh\":" << s.surface.speed_kmh;
        out << ",\"recommended_speed_kmh\":" << s.speed_advice.recommended_speed_kmh;
        out << ",\"froude\":" << s.speed_advice.froude;
        out << ",\"planing_threshold_kmh\":" << s.speed_advice.planing_threshold_kmh;
        out << ",\"pace\":\"" << json_escape(s.speed_advice.pace) << "\"";
        out << ",\"pace_label\":\"" << json_escape(s.speed_advice.pace_label) << "\"";
        out << ",\"motion_state\":\"" << json_escape(s.speed_advice.motion_state) << "\"";
        out << ",\"motion_label\":\"" << json_escape(s.speed_advice.motion_label) << "\"";
        out << ",\"narrow_waterway\":" << (s.speed_advice.narrow_waterway ? "true" : "false");
        out << ",\"cavitation_risk\":\"" << json_escape(s.speed_advice.cavitation_risk) << "\"";
        out << ",\"cavitation_label\":\"" << json_escape(s.speed_advice.cavitation_label) << "\"";
        out << ",\"speed_notes\":";
        write_string_array(out, s.speed_advice.notes);
        out << ",\"k_surf\":" << s.surface.k_surf;
        out << ",\"surface_risk\":" << s.surface.risk;
        out << ",\"time_h\":" << s.time_h;
        out << ",\"fuel_l\":" << s.fuel_l;
        out << ",\"fuel_l_h\":" << s.fuel_l_h;
        out << ",\"fuel_l_per_km\":" << s.fuel_l_per_km;
        out << ",\"resistance_n\":" << s.resistance_n;
        out << ",\"power_kw\":" << s.power_kw;
        out << ",\"total_mass_kg\":" << s.total_mass_kg;
        out << ",\"risk_points\":" << s.risk_points;
        out << ",\"cost\":" << s.cost;
        out << ",\"cost_components\":{\"distance\":" << s.distance_component
            << ",\"time\":" << s.time_component
            << ",\"fuel\":" << s.fuel_component
            << ",\"risk\":" << s.risk_component
            << ",\"planing_penalty\":" << s.planing_penalty
            << ",\"hard_penalty\":" << s.hard_penalty << "}";
        out << ",\"fuel_formula\":\"" << json_escape("F_seg = max(fuel_l_h * time_h, 0.08 * fallback); fuel_l_h = power_kw * bsfc_g_per_kwh * k_mode / (fuel_density_kg_l * 1000)") << "\"";
        out << ",\"planing\":" << (s.surface.planing ? "true" : "false");
        out << ",\"hard\":" << (s.surface.hard ? "true" : "false");
        out << "}";
    }
    out << "]}";

    out << ",\"totals\":{";
    out << "\"distance_km\":" << result.distance_km;
    out << ",\"time_h\":" << result.time_h;
    out << ",\"time_min\":" << result.time_h * 60.0;
    out << ",\"fuel_l\":" << result.fuel_l;
    out << ",\"risk_points\":" << result.risk_points;
    out << ",\"cost\":" << result.cost;
    out << ",\"tank_l\":" << scenario.boat.tank_l;
    out << ",\"remainder_l\":" << result.remainder_l;
    out << ",\"reserve_l\":" << result.reserve_l;
    out << "}";
    out << ",\"warnings\":";
    write_string_array(out, result.warnings);
    out << ",\"route_advice\":";
    write_string_array(out, result.route_advice);
    out << ",\"explanation\":\"" << json_escape("Маршрут выбран по режиму '" + result.mode + "'. C++ движок исключил недоступные участки и минимизировал соответствующую стоимость.") << "\"";
    out << "}\n";
}

static std::map<string, string> parse_args(int argc, char** argv) {
    std::map<string, string> args;
    for (int i = 1; i < argc; ++i) {
        string key = argv[i];
        if (key.rfind("--", 0) == 0 && i + 1 < argc) {
            args[key.substr(2)] = argv[++i];
        }
    }
    return args;
}

static void apply_boat_overrides(Boat& boat, const std::map<string, string>& args) {
    auto set_if_present = [&](const string& key, double& target, double low, double high) {
        auto it = args.find(key);
        if (it == args.end()) return;
        target = clamp_value(to_double(it->second, key), low, high);
    };
    set_if_present("base-l-per-km", boat.base_l_per_km, 0.05, 5.0);
    set_if_present("tank-l", boat.tank_l, 20.0, 2000.0);
    set_if_present("reserve-frac", boat.reserve_frac_tank, 0.0, 0.8);
    set_if_present("dry-mass-kg", boat.dry_mass_kg, 300.0, 6000.0);
    set_if_present("payload-kg", boat.payload_kg, 0.0, 3000.0);
    set_if_present("hull-length-m", boat.hull_length_m, 2.0, 20.0);
    set_if_present("engine-hp", boat.max_engine_hp, 20.0, 1200.0);
    set_if_present("prop-eff", boat.propulsive_efficiency, 0.2, 0.9);
    set_if_present("bsfc", boat.bsfc_g_per_kwh, 120.0, 650.0);
    set_if_present("fuel-density", boat.fuel_density_kg_l, 0.5, 0.95);
    set_if_present("resistance-area", boat.resistance_area_m2, 0.2, 12.0);
    set_if_present("air-drag-area", boat.air_drag_area_m2, 0.1, 10.0);
    set_if_present("displacement-cd", boat.displacement_cd, 0.05, 2.5);
    set_if_present("planing-cd", boat.planing_cd, 0.03, 1.5);
    set_if_present("surface-mu", boat.surface_mu, 0.001, 0.4);
    set_if_present("planing-froude-on", boat.planing_froude_on, 0.25, 2.0);
    set_if_present("planing-froude-full", boat.planing_froude_full, boat.planing_froude_on, 3.0);
    set_if_present("min-planing-speed-kmh", boat.min_planing_speed_kmh, 5.0, 120.0);
}

int main(int argc, char** argv) {
    try {
        auto args = parse_args(argc, argv);
        string data_path = args.count("data") ? args["data"] : "app_data/scenario.route";
        Scenario scenario = load_scenario(data_path);
        apply_boat_overrides(scenario.boat, args);
        string start = args.count("start") ? args["start"] : scenario.default_start;
        string finish = args.count("finish") ? args["finish"] : scenario.default_finish;
        string mode = args.count("mode") ? args["mode"] : "быстрый";
        string config = args.count("config") ? args["config"] : "без поддува";

        RouteResult result = calculate_route(scenario, start, finish, config, mode);
        write_result_json(std::cout, scenario, result);
        return result.ok ? 0 : 2;
    } catch (const std::exception& e) {
        std::cout << "{\"ok\":false,\"error\":\"" << json_escape(e.what()) << "\"}\n";
        return 1;
    }
}
