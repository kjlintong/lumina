#!/usr/bin/env python3
"""
从 Poly Haven 公共 API 下载资产（CC0，无登录）。

用法：
  python3 scripts/download-assets.py                    # 默认：HDR 2K + 5 家具 + 5 灯具（1k）
  python3 scripts/download-assets.py --hdr-only         # 只下 HDR 2K
  python3 scripts/download-assets.py --furniture-only   # 只下家具
  python3 scripts/download-assets.py --lights-only      # 只下灯具
  python3 scripts/download-assets.py --resolution 2k    # 模型分辨率
  python3 scripts/download-assets.py --skip-existing    # 已存在跳过

资产来源：
  - HDR：https://api.polyhaven.com/files/{slug} → dl.polyhaven.org（1k/2k/4k/8k/16k）
  - 模型：同上 API，gltf/1k/{slug}/{slug}_1k.gltf + .bin + Diffuse/Metal/Rough/Normal 贴图（PNG）

合规：
  - 所有资产 CC0，可商用无需署名（https://polyhaven.com/license）
  - API 条款要求发送 User-Agent（本脚本已设置）

目标目录：
  public/assets/hdris/     — .hdr
  public/assets/furniture/ — .gltf/.bin/.png（polyhaven 5 件家具）
  public/assets/lights/    — .gltf/.bin/.png（polyhaven 5 件灯具）

模型是分离的 .gltf + .bin + 贴图（polyhaven 提供），不是 .glb。
贴图引用相对路径 ./textures_1k/ 或类似，本脚本按 API 给的 URL 全部下载并
重写到本地相对路径，保证 GLTFLoader 加载时能在 public/ 静态目录内解析。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

UA = "lumina/0.1 (https://kjlintong.github.io)"
REFERER = "https://polyhaven.com/a/{slug}"
API_BASE = "https://api.polyhaven.com"

# 目标目录（相对 lumina repo 根）
REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC = REPO_ROOT / "public" / "assets"

# Poly Haven 真实 slug（大写小写敏感）
HDR_SLUGS = {
    "venice_sunset_2k": "venice_sunset",   # 黄金时刻
    "quarry_2k": "quarry_01",               # 白昼
    "venice_night_2k": "moonless_golf",     # 夜空（polyhaven 无 venice_night，用 moonless_golf 替代）
}

FURNITURE_SLUGS = {
    # 目标文件名 → polyhaven slug
    "sofa": "ArmChair_01",          # 沙发（polyhaven 无独立 sofa，用 ArmChair 最接近）
    "bed": "GothicBed_01",          # 床
    "table": "CoffeeTable_01",      # 餐桌（用咖啡桌占位；polyhaven 桌类偏小）
    "chair": "ArmChair_02",         # 餐椅
    "cabinet": "GothicCabinet_01",  # 柜
}

LIGHT_SLUGS = {
    # 目标文件名 → polyhaven slug
    "chandelier": "Chandelier_01",             # 吊灯
    "desk_lamp": "desk_lamp_arm_01",           # 台灯（带臂）
    "wall_sconce": "industrial_wall_sconce",   # 壁灯
    "ceiling_lamp": "modern_ceiling_lamp_01",  # 吸顶灯
    "pendant": "hanging_industrial_lamp",      # 吊灯（工业风，补上）
}


def http_get(url: str, timeout: int = 90, referer_slug: str | None = None) -> bytes:
    """带 User-Agent + Referer 的 GET，遵循 Poly Haven API 条款。
    用 subprocess 调 curl：Python urllib 在 WSL2 上被 Cloudflare 重置连接，
    curl 能过（polyhaven.com/llms.txt 与 dl.polyhaven.org 实测）。"""
    import subprocess
    import shutil
    if not shutil.which("curl"):
        raise RuntimeError("curl not found on PATH")
    cmd = [
        "curl", "-sL",
        "--connect-timeout", "8",
        "--max-time", str(timeout),
        "--retry", "1",
        "--retry-delay", "2",
        "-H", f"User-Agent: {UA}",
        "-H", f"Referer: {REFERER.format(slug=referer_slug or '')}",
        url,
    ]
    r = subprocess.run(cmd, capture_output=True, timeout=timeout + 30)
    if r.returncode != 0:
        raise RuntimeError(f"curl {r.returncode}: {url} :: {r.stderr.decode('utf-8','replace')[:200]}")
    return r.stdout


def fetch_json(url: str, timeout: int = 30, max_attempts: int = 6) -> dict:
    """带重试的 JSON 抓取。polyhaven API 在连续请求时会被 CF 限流（返回 HTML），
    指数退避 + 间隔能稳定通过。"""
    import time
    last_err = None
    for attempt in range(max_attempts):
        try:
            raw = http_get(url, timeout=timeout)
            if not raw or len(raw) < 2:
                raise RuntimeError("空响应")
            text = raw.decode("utf-8")
            if text.startswith("<"):
                raise RuntimeError(f"HTML 响应 ({len(text)} bytes)：CF 限流")
            return json.loads(text)
        except Exception as e:
            last_err = e
            wait = 4 * (2 ** attempt)
            print(f"    ! JSON 尝试 {attempt+1} 失败：{str(e)[:100]}；{wait}s 后重试")
            time.sleep(wait)
    raise RuntimeError(f"JSON 抓取最终失败 {url}: {last_err}")


def download_to(url: str, dest: Path, referer_slug: str | None = None,
                timeout: int = 120, skip_existing: bool = False) -> bool:
    """下载到 dest；成功返回 True，失败/跳过返回 False。
    内置重试：dl.polyhaven.org 在连续请求时会被 CF 限流（表现为 curl 超时），
    重试加指数退避 + 请求间隔能稳定通过。"""
    import time
    if skip_existing and dest.exists() and dest.stat().st_size > 0:
        return False
    last_err = None
    for attempt in range(6):
        try:
            data = http_get(url, timeout=timeout, referer_slug=referer_slug)
            if len(data) < 100:
                raise RuntimeError(f"响应太小 ({len(data)} bytes)：可能是 CF 拦截页")
            # CF 拦截页特征：短 HTML（94 字节是 polyhaven 的固定 404 页），
            # 正常 .bin 最小也有 KB 级；正常 .gltf 也是 KB 级 JSON。
            # 简单校验：非 binary 的短 HTML 一律当拦截。
            if len(data) < 1000 and data.startswith(b"<"):
                raise RuntimeError(f"返回 HTML ({len(data)} bytes)：CF 拦截页")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            # 请求间隔，避免触发 CF 限流
            time.sleep(2.0)
            return True
        except Exception as e:
            last_err = e
            wait = 4 * (2 ** attempt)
            print(f"    ! 尝试 {attempt+1} 失败：{str(e)[:120]}；{wait}s 后重试")
            time.sleep(wait)
    raise RuntimeError(f"下载最终失败 {url}: {last_err}")


def download_hdr(skip_existing: bool) -> None:
    """下载 3 张 2K HDR 到 public/assets/hdris/。"""
    dest_dir = PUBLIC / "hdris"
    dest_dir.mkdir(parents=True, exist_ok=True)
    for fname, slug in HDR_SLUGS.items():
        dest = dest_dir / f"{fname}.hdr"
        if skip_existing and dest.exists() and dest.stat().st_size > 0:
            print(f"  [skip] {dest.name}")
            continue
        info = fetch_json(f"{API_BASE}/files/{slug}")
        # 结构：{ "hdri": { "2k": { "hdr": { "url": ..., "size": ... } } } }
        url = info["hdri"]["2k"]["hdr"]["url"]
        size = info["hdri"]["2k"]["hdr"]["size"]
        print(f"  [hdr] {slug} -> {dest.name} ({size/1024/1024:.2f} MB)")
        if download_to(url, dest, referer_slug=slug):
            print(f"         OK ({dest.stat().st_size/1024/1024:.2f} MB)")


def download_model(slug: str, dest_dir: Path, resolution: str = "1k",
                   skip_existing: bool = False) -> dict:
    """
    下载单个模型的分离资产（.gltf + .bin + 贴图），全部按 polyhaven 原路径结构落到 dest_dir。
    GLTFLoader 能解析 .gltf 里的相对路径（textures/*.png 等）。
    返回 {"files": [...], "gltf": "xxx.gltf"} 便于 loader 知道入口。
    """
    info = fetch_json(f"{API_BASE}/files/{slug}")
    files_downloaded = []

    # 1) .gltf 主文件
    gltf_url = info["gltf"][resolution]["gltf"]["url"]
    # URL 例：https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/Chandelier_01/Chandelier_01_1k.gltf
    gltf_dir = gltf_url.rsplit("/", 1)[0]  # .gltf 所在目录（.bin 与它同目录）
    gltf_name = gltf_url.rsplit("/", 1)[-1]
    gltf_dest = dest_dir / gltf_name
    print(f"  [gltf] {gltf_name} ({info['gltf'][resolution]['gltf']['size']/1024:.0f} KB)")
    download_to(gltf_url, gltf_dest, referer_slug=slug, skip_existing=skip_existing)
    files_downloaded.append(gltf_dest)

    # 2) 从 .gltf 拿 image.name，按 name 到 API 里查对应的 jpg URL
    #    .gltf images: [{name: "Armchair_01_diff", uri: "textures/Armchair_01_diff_1k.jpg", mimeType: "image/jpeg"}, ...]
    #    API 结构：{ "Diffuse": { "1k": { "jpg": { "url": "https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/{slug}/Armchair_01_diff_1k.jpg" } } } }
    #    策略：遍历 API 的 map 类型，从每个 map 的 {resolution}.jpg 拿 URL，
    #         按 basename 匹配 .gltf 里的 uri（basename 一致）。
    # 解析 .gltf 拿到 buffers 与 images（贴图 URI 用于校验本地路径）
    gltf_data = {"images": [], "buffers": []}
    try:
        gltf_data = json.loads(gltf_dest.read_bytes())
    except Exception:
        pass

    # .bin（同 .gltf 目录）
    bin_uris = set()
    for buffer_info in gltf_data.get("buffers", []):
        u = buffer_info.get("uri", "")
        if u:
            bin_uris.add(u.lstrip("./"))
    for uri in bin_uris:
        local_dest = dest_dir / uri
        if local_dest.exists() and local_dest.stat().st_size > 0:
            continue
        print(f"  [bin] {uri}")
        abspath = gltf_dir.rstrip("/") + "/" + uri
        download_to(abspath, local_dest, referer_slug=slug, skip_existing=skip_existing)

    # 贴图（从 API 拿真实 URL）
    MAP_TYPES = ["Diffuse", "Metal", "Rough", "nor_gl", "nor_dx", "arm", "blend"]
    for map_type in MAP_TYPES:
        map_data = info.get(map_type) or info.get(map_type.lower())
        if not map_data:
            continue
        res_data = map_data.get(resolution) or map_data.get("2k") or map_data.get("4k")
        if not res_data:
            continue
        jpg_data = res_data.get("jpg") or res_data.get("png")
        if not jpg_data:
            continue
        url = jpg_data["url"]
        basename = url.rsplit("/", 1)[-1]
        # 放到 textures/ 子目录（.gltf 里 URI 就是 textures/xxx.jpg）
        local_dest = dest_dir / "textures" / basename
        if local_dest.exists() and local_dest.stat().st_size > 0:
            continue
        print(f"  [tex] {basename}")
        download_to(url, local_dest, referer_slug=slug, skip_existing=skip_existing)

    return {
        "slug": slug,
        "gltf": gltf_name,
        "files": sorted({
            p.name for p in dest_dir.iterdir() if p.is_file()
        } | {
            f"textures/{p.name}" for p in (dest_dir / "textures").iterdir()
            if p.is_file()
        } if (dest_dir / "textures").exists() else set()),
    }


def download_models(slug_map: dict, dest_dir: Path, category: str,
                    resolution: str = "1k", skip_existing: bool = False) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for target_name, slug in slug_map.items():
        print(f"  [{category}] {slug} -> {dest_dir.name}/{target_name}/")
        sub = dest_dir / target_name
        info = download_model(slug, sub, resolution=resolution, skip_existing=skip_existing)
        manifest[target_name] = info

    # 写一个 manifest 便于 loader 快速识别（可选）
    manifest_path = dest_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"  [manifest] {manifest_path}")


def main() -> int:
    ap = argparse.ArgumentParser(description="下载 Poly Haven 资产（CC0）到 lumina/public/assets/")
    ap.add_argument("--resolution", choices=["1k", "2k", "4k"], default="1k",
                    help="模型分辨率（贴图大小；默认 1k，体积最小）")
    ap.add_argument("--hdr-only", action="store_true")
    ap.add_argument("--furniture-only", action="store_true")
    ap.add_argument("--lights-only", action="store_true")
    ap.add_argument("--skip-existing", action="store_true", help="已存在的文件跳过")
    args = ap.parse_args()

    do_hdr = not (args.furniture_only or args.lights_only)
    do_furn = not (args.hdr_only or args.lights_only)
    do_lights = not (args.hdr_only or args.furniture_only)

    print(f"=== Poly Haven 资产下载 (UA={UA}) ===")
    print(f"目标：{PUBLIC}\n")

    if do_hdr:
        print("[1/3] HDR 2K")
        download_hdr(args.skip_existing)
        print()

    if do_furn:
        print(f"[2/3] 家具（{args.resolution}）")
        download_models(FURNITURE_SLUGS, PUBLIC / "furniture", "家具",
                        resolution=args.resolution, skip_existing=args.skip_existing)
        print()

    if do_lights:
        print(f"[3/3] 灯具（{args.resolution}）")
        download_models(LIGHT_SLUGS, PUBLIC / "lights", "灯具",
                        resolution=args.resolution, skip_existing=args.skip_existing)
        print()

    print("完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
