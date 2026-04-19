/**
 * 学校配置文件
 * 对标 Python 版 edu-sys-crawler/app/config/config_school.py
 */

export interface SchoolConfig {
  /** 学校名称 */
  name: string;
  /** Playwright 自动化登录配置 */
  playwright: {
    /** 是否已实现 Playwright 自动化登录 */
    enabled: boolean;
    /**
     * 是否屏蔽登录页的图片资源（加快加载）
     * - true（默认）：屏蔽所有图片，适合无验证码或只需文字验证码的学校
     * - false：不屏蔽图片，适合有图形验证码需要 OCR 识别的学校
     */
    blockImages?: boolean;
  };
  /** Redis 缓存配置 */
  cache: {
    /** 是否启用 Redis 缓存 */
    enabled: boolean;
    /** 缓存时长（秒），默认 1800 = 30 分钟 */
    ttl: number;
    /**
     * 距过期剩余多少秒时视为「即将过期」，主动触发刷新
     * 默认 120 = 2 分钟
     */
    minRemain: number;
  };
}

/** 默认缓存配置
 *
 * TTL 策略说明：
 *   各学校教务 Session 的实际有效期由其 CAS 服务器决定，本系统无法主动感知。
 *   使用"保守 TTL + 主动失效"双重策略：
 *
 *   1. 保守 TTL（30分钟）：
 *      比绝大多数教务系统 Session 的最短有效期（一般 10~30 分钟）更短，
 *      确保 Redis 里的缓存在学校服务器那边大概率还没失效。
 *
 *   2. 主动失效（爬虫项目负责）：
 *      爬虫携带 Cookie 请求数据时若收到 401/302（跳到登录页），
 *      应立即调用 POST /session/delete 清除缓存，
 *      再调用 POST /session/login 重新获取，实现按需刷新。
 *
 *   两者配合：TTL 兜底防止缓存无限期有效；主动失效保证实时感知 Cookie 过期。
 */
const defaultCache: SchoolConfig['cache'] = {
  enabled: true,
  ttl: 1800, // 30 分钟，保守策略（实际过期以学校 CAS 服务器为准）
  minRemain: 120, // 距过期不足 2 分钟时视为即将过期，主动触发刷新入队
};

export const schools: Record<string, SchoolConfig> = {
  '0001': {
    name: '中南大学',
    playwright: { enabled: true, blockImages: true },
    cache: { ...defaultCache },
  },
  '0002': {
    name: '湖南大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0003': {
    name: '湖南师范大学',
    playwright: { enabled: true, blockImages: true },
    cache: { ...defaultCache },
  },
  '0004': {
    name: '长沙理工大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0005': {
    name: '湘潭大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0006': {
    name: '湖南科技大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0007': {
    name: '中南林业科技大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0008': {
    name: '南华大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0009': {
    name: '湖南农业大学',
    playwright: { enabled: true, blockImages: true },
    cache: { ...defaultCache },
  },
  '0010': {
    name: '湖南中医药大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0011': {
    name: '湖南工商大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0012': {
    name: '湖南工业大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0013': {
    name: '湖南第一师范学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0014': {
    name: '湖南理工学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0015': {
    name: '吉首大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0016': {
    name: '衡阳师范学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0018': {
    name: '湖南工程学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0019': {
    name: '湖南文理学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0021': {
    name: '长沙师范学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0024': {
    name: '湖南工学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0027': {
    name: '怀化学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0030': {
    name: '湖南女子学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0031': {
    name: '长沙医学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0032': {
    name: '湖南涉外经济学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0034': {
    name: '湖南信息学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0035': {
    name: '湖南交通工程学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0037': {
    name: '长沙理工大学城南学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0039': {
    name: '湖南中医药大学湘杏学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0040': {
    name: '中南林业科技大学涉外学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0041': {
    name: '湘潭理工学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0051': {
    name: '湖南软件职业技术大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0052': {
    name: '湖南财政经济学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0055': {
    name: '湖南工业职业技术学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0056': {
    name: '湖南大众传媒职业技术学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0057': {
    name: '湖南交通职业技术学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0059': {
    name: '湖南商务职业技术学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0065': {
    name: '湖南科技职业学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0072': {
    name: '长沙幼儿师范高等专科学校',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0077': {
    name: '湖南现代物流职业技术学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0105': {
    name: '湖南民族职业学院',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0719': {
    name: '中央民族大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0722': {
    name: '北京交通大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '0731': {
    name: '中国地质大学',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
  '1788': {
    name: '江西师范高等专科学校',
    playwright: { enabled: false },
    cache: { ...defaultCache },
  },
};

/**
 * 获取学校配置，不存在时返回 undefined
 */
export function getSchoolConfig(schoolId: string): SchoolConfig | undefined {
  return schools[schoolId];
}
