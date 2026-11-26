# `08-asyncio_create_task.py` 代码精讲：后台任务调度（`asyncio.create_task`）与防重复提交

> **源文件位置**：`前置知识/3-异步编程/08-asyncio_create_task.py`  
> **所属模块**：前置知识 — 专题 3：Python 异步编程  
> **一句话定位**：演示如何用 `asyncio.create_task()` 将耗时协程立即投入事件循环后台执行，并配合字典追踪任务状态 `task.done()`，实现高并发 Web 网关的“异步提交 + 防重复提交”架构。

---

## 一、文件定位与核心前置知识精讲

### 1.1 `await coro()` vs `asyncio.create_task(coro())` 的本质区别
- **`await process_chat(...)`**：原地暂停等待，直到 2 秒后 `process_chat` 彻底跑完，才能执行下一行代码；
- **`task = asyncio.create_task(process_chat(...))`**：
  - 瞬间把协程封装成一个 `asyncio.Task` 对象，**立刻排入事件循环的就绪队列准备后台执行**，而主程序**不等待、立刻继续往下走**（Fire-and-Forget 模式）；
  - 当主程序稍后需要查看它是否跑完时，可以调用 `task.done()`（返回 `True` 或 `False`）；
  - 当主程序最终需要拿它的返回值时，随时可以 `result = await task`。

### 1.2 为什么必须把 `task` 存进全局字典 `background_tasks`？
1. **防重复提交（核心业务需求）**：在 `main_http_api.py` 的 `/api/chat_async` 中，用户可能因为网络慢连点 3 次发送按钮。通过检查 `if redis_key in _tasks and not _tasks[redis_key].done():`，可以立刻拦截重复请求，避免花 3 份大模型 Token 费用！
2. **防止被 Python 垃圾回收器（GC）误杀（官方重要警告！）**：Python 官方文档明确提醒，事件循环只对后台 Task 持有**弱引用**。如果你只写 `asyncio.create_task(foo())` 而不把返回值保存到某个集合或字典里，任务运行到一半可能会被垃圾回收器意外销毁！把 `task` 存进 `background_tasks` 字典（并在完成后 `pop` 移除）是最标准的工程做法。

### 1.3 这个知识点在 Voyage 智途主项目的哪里用到了？
- **`main_http_api.py` 第 257~307 行**：`_tasks: dict[str, asyncio.Task] = {}` 与 `_tasks[redis_key] = asyncio.create_task(_run())`，构成了 `/api/chat_async` 异步提交接口的完整底层骨架！

---

## 二、执行时间轴示意图

```mermaid
sequenceDiagram
    autonumber
    participant Main as main() 主协程
    participant Loop as Event Loop 后台 Task (process_chat)

    Main->>Loop: 0.0s asyncio.create_task(process_chat) 立即返回 task 对象
    Main->>Main: 0.0s 存入 background_tasks["user_001"] = task
    Main->>Main: 0.0s 打印 "返回响应给前端: 收到，处理中..."
    Main->>Main: 0.0s await asyncio.sleep(0.5) (主程序让出CPU，后台 Task 趁机开始执行!)
    Note over Loop: 0.0s 打印 "[后台] 开始处理..." 并进入 sleep(2.0s)
    Main->>Main: 0.5s 检查 task.done() -> False (还在后台跑)
    Main->>Loop: 0.5s 执行 result = await task (等待后台完成)
    Note over Loop: 2.0s 打印 "[后台] 处理完成" 并返回 "user_001 的回复"
    Loop-->>Main: 2.0s 返回 result，此时 task.done() -> True
```

---

## 三、完整源码与逐行深度拆解

### 3.1 完整源码（100% 原样收录）
```python
# 3.8 asyncio.create_task() - 后台任务
# 把协程包装成 Task 立即返回，不等待完成（fire-and-forget）
# 项目中 main_http_api.py 用 create_task 做后台聊天处理
#   _tasks[redis_key] = asyncio.create_task(_run())

import asyncio


# 模拟后台任务追踪字典（项目中: _tasks: dict[str, asyncio.Task] = {}）
background_tasks = {}


async def process_chat(user_id, message):
    """模拟后台聊天处理（耗时操作）"""
    print(f"  [后台] 开始处理 {user_id} 的消息: {message}")
    await asyncio.sleep(2)  # 模拟 LLM 推理 + Agent 调用
    print(f"  [后台] {user_id} 处理完成")
    return f"{user_id} 的回复"


async def main():
    # ---- 场景：用户发消息后立即返回，后台异步处理 ----
    print("=== 后台任务模式 ===")

    # 1. 创建后台任务（不等待，立即继续）
    user_id = "user_001"
    task = asyncio.create_task(process_chat(user_id, "北京天气怎么样？"))
    background_tasks[user_id] = task
    print("已提交，正在后台处理...\n")

    # 2. 主程序继续做其他事（不被阻塞）
    print("[主程序] 返回响应给前端: '收到，处理中...'")
    await asyncio.sleep(0.5)  # 模拟其他操作
    print(f"[主程序] 任务状态: done={task.done()}\n")

    # 3. 等待后台任务完成
    print("[主程序] 等待后台任务...")
    result = await task
    # result2 = await background_tasks[user_id]
    print(f"[主程序] 后台任务完成: {result}")
    print(f"[主程序] 任务状态: done={task.done()}")

    # 4. 检查任务是否已完成（项目中用来防止重复提交）
    if background_tasks[user_id].done():
        print(f"\n{user_id} 的任务已完成，可以接受新请求")


if __name__ == "__main__":
    asyncio.run(main())
```

### 3.2 逐行精讲与沙盘推演（Dry Run）
**观察控制台输出的精确先后顺序（极易答错的面试题！）**：
```text
=== 后台任务模式 ===
已提交，正在后台处理...

[主程序] 返回响应给前端: '收到，处理中...'
  [后台] 开始处理 user_001 的消息: 北京天气怎么样？   <-- 注意！直到主程序遇到 await asyncio.sleep(0.5) 才打印这行！
[主程序] 任务状态: done=False

[主程序] 等待后台任务...
  [后台] user_001 处理完成
[主程序] 后台任务完成: user_001 的回复
[主程序] 任务状态: done=True

user_001 的任务已完成，可以接受新请求
```
- **为什么 `[后台] 开始处理...` 是在 `[主程序] 返回响应给前端...` 之后才打印的？**
  - 因为 `asyncio.create_task(...)` 只是把任务放进事件循环队列，当前仍在执行 `main()` 函数；直到第 33 行 `main()` 遇到了 `await asyncio.sleep(0.5)` 交出控制权，事件循环才切换到后台 Task 开始执行它的第一行 `print`！

---

## 四、横向对比：`gather` vs `create_task` vs `to_thread` vs `wait_for`

| API | 核心职责 | 是否立即返回不等待 | 主项目典型应用场景 |
| :--- | :--- | :--- | :--- |
| `asyncio.gather` | 打包多个协程并发跑，全部跑完统一收结果 | 否（需 `await`） | 同时调用多个 A2A 子智能体 |
| `asyncio.create_task` | 把单个协程丢后台跑，主流程继续干别的 | **是**（立即返回 `Task`） | `/api/chat_async` 异步提交任务 |
| `asyncio.to_thread` | 把同步阻塞函数丢进线程池执行 | 否（需 `await`） | 在 FastAPI 中调用 `pymysql` / `redis` / `pymilvus` |
| `asyncio.wait_for` | 给协程加超时倒计时，超时自动取消 | 否（需 `await`） | 给 A2A 远程调用设置 150 秒超时熔断 |

---

## 五、自测思考题

### 思考题 1
在 `main_http_api.py` 的 `_run()` 的 `finally` 块中，为什么要执行 `_tasks.pop(redis_key, None)`？如果不删会怎样？
> **参考答案**：如果不从全局字典 `_tasks` 中移除已完成的 `Task` 对象，随着成千上万个用户不断提问，字典会无限膨胀，导致严重的**内存泄漏（Memory Leak）**。

### 思考题 2
如果一个 `Task` 已经完成（`task.done() == True`），再次执行 `await task` 会重新执行一遍 `process_chat` 吗？
> **参考答案**：**不会重新执行**！一个 `Task` 对象只会执行一次，完成后它的结果会缓存在 `Task` 对象内部；再次 `await task` 会立刻返回之前保存的那个结果。
