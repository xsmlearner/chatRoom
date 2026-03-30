<script setup>
import { ref } from 'vue'

const emit = defineEmits(['login', 'register'])
const username = ref('')
const password = ref('')
const registerPassphrase = ref('')
const mode = ref('login')

function submit() {
  if (mode.value === 'login') emit('login', { username: username.value.trim(), password: password.value })
  else emit('register', { username: username.value.trim(), password: password.value, registerPassphrase: registerPassphrase.value })
}
</script>

<template>
  <div class="auth-wrap">
    <h1>手机聊天室</h1>
    <div class="tabs">
      <button :class="{ on: mode === 'login' }" @click="mode = 'login'">登录</button>
      <button :class="{ on: mode === 'register' }" @click="mode = 'register'">注册</button>
    </div>
    <input v-model="username" placeholder="用户名" />
    <input v-model="password" type="password" placeholder="密码" />
    <input v-if="mode === 'register'" v-model="registerPassphrase" type="password" placeholder="注册口令（管理员提供）" />
    <button class="submit" @click="submit">{{ mode === 'login' ? '进入聊天室' : '创建账号' }}</button>
  </div>
</template>

<style scoped>
.auth-wrap {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: center;
  padding: 24px;
}
.tabs {
  display: flex;
  gap: 8px;
}
input,
button {
  min-height: 48px;
  border-radius: 14px;
  border: 1px solid var(--line);
  padding: 0 14px;
  background: var(--bg-elev);
  color: var(--text);
}
.tabs button.on,
.submit {
  border: none;
  background: linear-gradient(135deg, var(--primary), var(--primary-2));
  color: #fff;
}
</style>
