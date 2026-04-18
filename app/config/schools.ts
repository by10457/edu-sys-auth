/**
 * 学校配置文件
 * 对标 Python 版 edu-sys-crawler/app/config/config_school.py
 */

export interface SchoolConfig {
  /** 学校名称 */
  name: string;
  /** 教务系统基础 URL */
  baseUrl: string;
  /** 备用 baseUrl（部分学校有多个入口） */
  type2BaseUrl?: string;
  /** Playwright 自动化登录配置 */
  playwright: {
    /** 是否已实现 Playwright 自动化登录 */
    enabled: boolean;
  };
  /** Redis 缓存配置 */
  cache: {
    /** 是否启用 Redis 缓存 */
    enabled: boolean;
    /** 缓存时长（秒），默认 7200 = 2 小时 */
    ttl: number;
    /**
     * 距过期剩余多少秒时视为「即将过期」，主动触发刷新
     * 默认 300 = 5 分钟
     */
    minRemain: number;
  };
  /**
   * 禁止访问时间段，格式 "HH:mm-HH:mm"
   * 例：["23:00-06:30"]
   */
  timeLimit?: string[];
}

/** 默认缓存配置 */
const defaultCache: SchoolConfig['cache'] = {
  enabled: true,
  ttl: 7200,
  minRemain: 300,
};

export const schools: Record<string, SchoolConfig> = {
  '0001': {
    name: '中南大学',
    baseUrl: 'http://csujwc.its.csu.edu.cn',
    playwright: { enabled: true },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0002': {
    name: '湖南大学',
    baseUrl: 'http://hdjw.hnu.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0003': {
    name: '湖南师范大学',
    baseUrl: 'https://jwglnew.hunnu.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0004': {
    name: '长沙理工大学',
    baseUrl: 'http://xk.csust.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0005': {
    name: '湘潭大学',
    baseUrl: 'https://jwxt.xtu.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0006': {
    name: '湖南科技大学',
    baseUrl: 'https://webvpn.hnust.edu.cn/https/77726476706e69737468656265737421fbf34b8b693866456d1cc7a99c406d3642',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0007': {
    name: '中南林业科技大学',
    baseUrl: 'https://http-jwgl-csuft-edu-cn-80.webvpn.csuft.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0008': {
    name: '南华大学',
    baseUrl: 'http://jwzx.usc.edu.cn:8924',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0009': {
    name: '湖南农业大学',
    baseUrl: 'https://webvpn.hunau.edu.cn/http/77777776706e6973746865626573742117075065b065b1ed23b25545bb868160e0',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0010': {
    name: '湖南中医药大学',
    baseUrl: 'https://jwxt.hnucm.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: ['23:00-23:59', '00:00-06:30'],
  },
  '0011': {
    name: '湖南工商大学',
    baseUrl: 'http://jwgl.hutb.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0012': {
    name: '湖南工业大学',
    baseUrl: 'http://jwxt.hut.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0013': {
    name: '湖南第一师范学院',
    baseUrl: 'https://jwgl.hnfnu.edu.cn:9080',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0014': {
    name: '湖南理工学院',
    baseUrl: 'https://vpn.hnist.cn/https/57524476706e697374686562657374213e154cdfb2e93588062c39d9',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0015': {
    name: '吉首大学',
    baseUrl: 'https://jwxt.jsu.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0016': {
    name: '衡阳师范学院',
    baseUrl: 'https://hysfjw.hynu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0018': {
    name: '湖南工程学院',
    baseUrl: 'https://jwcmis.hnie.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0019': {
    name: '湖南文理学院',
    baseUrl: 'https://xyjw.huas.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0021': {
    name: '长沙师范学院',
    baseUrl: 'http://58.20.34.197:10115/cssfjw',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0024': {
    name: '湖南工学院',
    baseUrl: 'https://cas.hnit.edu.cn/',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0027': {
    name: '怀化学院',
    baseUrl: 'https://jwmis.hhtc.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0030': {
    name: '湖南女子学院',
    baseUrl: 'http://jwgl.hnwu.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0031': {
    name: '长沙医学院',
    baseUrl: 'http://oa.csmu.edu.cn:8099',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0032': {
    name: '湖南涉外经济学院',
    baseUrl: 'http://jw.hieu.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: ['23:00-06:30'],
  },
  '0034': {
    name: '湖南信息学院',
    baseUrl: 'https://jwgl.hnuit.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0035': {
    name: '湖南交通工程学院',
    baseUrl: 'https://jw.hnjt.edu.cn/',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0037': {
    name: '长沙理工大学城南学院',
    baseUrl: 'http://xk.csust.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0039': {
    name: '湖南中医药大学湘杏学院',
    baseUrl: 'https://jwxt.hnucm.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0040': {
    name: '中南林业科技大学涉外学院',
    baseUrl: 'http://zswxyjw.yinghuaonline.com',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0041': {
    name: '湘潭理工学院',
    baseUrl: 'https://49.234.155.183/hngsdxbjxy_jsxsd',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0051': {
    name: '湖南软件职业技术大学',
    baseUrl: 'http://jw.hnsoftedu.com',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0052': {
    name: '湖南财政经济学院',
    baseUrl: 'https://vpn.hufe.edu.cn/http/77726476706e69737468656265737421fafe409330253a1e761d8fa9d6502720da5a99',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0055': {
    name: '湖南工业职业技术学院',
    baseUrl: 'http://ehall.hunangy.com',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0056': {
    name: '湖南大众传媒职业技术学院',
    baseUrl: 'http://220.168.55.212:8000',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0057': {
    name: '湖南交通职业技术学院',
    baseUrl: 'https://jwxt.hnjtzy.com.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0059': {
    name: '湖南商务职业技术学院',
    baseUrl: 'http://jwxt.hnvcc.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0065': {
    name: '湖南科技职业学院',
    baseUrl: 'https://jwyth.hnkjxy.net.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0072': {
    name: '长沙幼儿师范高等专科学校',
    baseUrl: 'http://61.186.94.104:8090',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0077': {
    name: '湖南现代物流职业技术学院',
    baseUrl: 'https://jwglxt.hmlc.edu.cn/',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0105': {
    name: '湖南民族职业学院',
    baseUrl: 'https://hnvc.jw.chaoxing.com/admin',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0719': {
    name: '中央民族大学',
    baseUrl: 'https://jwxs.muc.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0722': {
    name: '北京交通大学',
    baseUrl: 'https://aa.bjtu.edu.cn',
    type2BaseUrl: 'https://wdean.bjtu.edu.cn:8443',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '0731': {
    name: '中国地质大学',
    baseUrl: 'https://elib.cugb.edu.cn',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
  '1788': {
    name: '江西师范高等专科学校',
    baseUrl: 'http://jw.jxsfgz.com:86',
    playwright: { enabled: false },
    cache: { ...defaultCache },
    timeLimit: [],
  },
};

/**
 * 获取学校配置，不存在时返回 undefined
 */
export function getSchoolConfig(schoolId: string): SchoolConfig | undefined {
  return schools[schoolId];
}
