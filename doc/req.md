# 角色
你是ai开发专家,obsidian 插件开发专家.

开发一个obsidian插件
---
# 插件名为`MindNote`
该插件用mindmap的node组织obsidian的文件.目的是易于可视化obsidian目录操作.

## 文件结构:
```
{filename}.mn/    # .mn 结尾的文件夹 视为 Bundle ,filename是实际的包名
 ├─ md/        # 每个节点一个 md
 ├─ img/          # 所有图片资源
 ├─ file/         # 所有markdown和图片之外的资源,如 `.txt .pdf .exel .json`等
 ├─ map.mn     # mindmap 结构,json格式
```
所有文件包装在一 '.mn'结尾的文件夹.中,map.mn存放节点信息.
map.mn文件结构如下:
```
{
"nodeData": {
    "id": "bb9eb17385d771d8",
    "topic": "AI方法论",
    "filepath":"AI方法论.md",
    "children": [{
        "topic": "工具",
        "id": "bba58b982b706b24",
        "filepath":"工具.md",
        "children": [
          {
            "topic": "Antigravity",
            "id": "bb9eb318f64405aa",
            "filepath":"Antigravity.md",
            "children": [],
            "expanded": true
          }
        ],
        "expanded": true
      }
]
}
```

## 节点的结构如下:
```
{
"topic": "", //节点内容
"id": "", // 节点id 
"filepath":"", // 节点对应markdown文件名
"children": [],	// 子节点
"expanded": true // 是否展开节点
}
```
##settings
obsidian插件配置如下:
```
{
  "direction": 1,    // mindmap 节点展开方向:("0", "Left")("1", "Right")("2", "Both Sides")
  "theme": "primary",// theme主题 ("primary", "Primary (Light)")("dark", "Dark")("auto", "Follow Obsidian")
  "horizontalGap": 10, // mindmap Horizontal distance between parent and child nodes (--node-gap-x)
  "verticalGap": 5,  //Vertical distance between sibling nodes (--node-gap-y)
  "mainHorizontalGap": 5, //Horizontal margin for main branches (--main-gap-x)
  "mainVerticalGap": 5, //Vertical margin for main branches (--main-gap-y)
  "topicPadding": 5, //Internal padding of nodes (--topic-padding)
  "nodeRadius": 3, // Border radius for child nodes (--main-radius)
  "rootRadius": 3, // Border radius for root node (--root-radius)
  "lineWidth": 1 //Thickness of the lines connecting nodes
}

```
## 图片预览页面
1. 显示图片,按滚轮可以缩放图片
2. 双击图片,恢复原始大小
3. 在右上角显示关闭按钮

## create new MindNote页面
1. 参考 create new base 页面 

## mindmap功能:
0.mindmap打开时加载settings中的配置项
1.使用 mind-elixir 展示mindmap.
2.启用 mind-exlixir 的所有默认功能
3.参考标准的mindmap的粘贴处理方法.自动分析粘贴板内容,如果是节点,采用默认粘贴逻辑.如果是图片,添加图片子节点.如果是文本,自动拆分文本内容,添加子节点和子孙节点.
4.图片节点.拖动或粘贴图片,显示图片节点.图片存放在img文件夹中.节点中显示按图片比例的缩略图.双击节点缩略图,打开图片预览页面.双击节点文字,编辑图片节点topic.
5.其他资源节点,
5.按空格键,当前节点进入编辑模式.

## mindmap节点与markdown文件对应
1. 新建节点:
   - 建立对应的markdown文档,放在.mn文件夹下的md文件夹中.
   - 所有的文件操作必须使用Obsidian的API (`vault.create`, `vault.adapter`等), **严禁使用Node.js的`fs`模块**.
   - **重名处理**: 如果目标文件名(默认为topic.md)已存在,则自动添加后缀 `_1`, `_2` 等(如 `topic_1.md`),直到文件名唯一.此规则同样适用于 "新建 MindNote" 时的根节点文件.
2. 编辑节点(重命名):
   - 重命名对应的markdown文件,默认使用新topic作为文件名.
   - 非法字符替换为'_'.
   - **重名处理**: 如果新文件名已存在,同样自动添加后缀 `_1`, `_2` 等,确保文件重命名成功且不覆盖现有文件.
3. 点击节点,在obsidian 右侧打开对应的markdown文件,并保存关闭前面打开的节点的markdown文件.
4. 删除节点,保证对应节点的markdown文件删除,保证对应节点的图片资源删除,保证对应markdown文件内的图片资源删除.
5. 使用obsdian内部机制实现文件的销毁

## mindmap历史记录功能
1. mindmap 保留修改历史.无论时新建节点,删除节点,移动节点,修改节点,保留历史:快捷键`ctrl+z`撤销修改,快捷键`ctrl+shift+z`重做修改.
2. 使用obsdian内部机制实现历史记录
3. 历史记录同时记录对应的资源,如markdown文件,mardown 对应的图片 及节点图片等


## markdown 功能
1. 拖动和粘贴资源(图片,文本等) 到MindNote内的markdown文件,将对应的资源添加到对应位置. 图片放到img文件夹,其他资源放到file文件夹.
2. 这个功能不影响mindnote之外的markdown文件.


## obsidian 功能
1. mindmap注册边栏菜单 "Create new MindNote",打开create new MindNote页面.创建目录结构,并打开视图.视图显示 目录名.如 创建了"mynote.mn",视图显示 mynote.
3. mindmap注册打开文件夹和文件的右键菜单"Open as MindNote".检查是否是.mn结尾的目录,检查目录下是否有map.mn.
3. 注册文件类型'.mn',点击.mn文件打开视图,视图显示目录名,如点击了map.mn,检查他的父目录,如果以"xx.mn"的格式,视图显示 'xx'.
4. mindmap 节点对应的markdown 打开时,显示节点的topic.系统任务栏也显示节点的topic而不是文件名.
5. 通过节点打开的markdown文件,不可以手动重命名.
6. 关闭mindnote 视图时,保存并关闭所有相关文件.

# 代码结构
## 技术栈
	Obsidian API (Strictly enforce: NO Node.js `fs` module usage),
	TypeScript, 
	mind-elixir
	
## interface
```
export interface MindNoteSettings {
    direction: number;
    theme: string;
    horizontalGap: number;  // --node-gap-x
    verticalGap: number;    // --node-gap-y
    mainHorizontalGap: number; // --main-gap-x
    mainVerticalGap: number;   // --main-gap-y
    topicPadding: number;   // --topic-padding
    nodeRadius: number;     // --main-radius
    rootRadius: number;     // --root-radius
    lineWidth: number;      // stroke-width of lines
}

export interface MindNode {
  id: string;
  topic: string;
  filepath: string;
  children: MindNode[];
  expanded:bool;
}

```