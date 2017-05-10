---
layout:     post
title:      "使用Jedis实现JCaptcha验证码存储"
subtitle:   "JCaptcha默认将验证码存储在内存中, 对于多用户高并发的应用来说, 这种方式显然不是很好"
date:       2017-04-25 15:59:00
author:     "Joey"
header-img: "img/post-bg-02.jpg"
---

# 前言
主要用图片验证码, 语音验证码没有用所以没有涉及.

# 环境
文中使用的环境:
- Spring, Spring MVC
- Redis服务端, Redis Java客户端 Jedis
- [JCaptcha](http://jcaptcha.sourceforge.net/) 2.0-alpha-1

# JCaptcha 图片验证码主要组件
- `ImageCaptchaService` 顾名思义, 这个接口的实现类提供图片验证码服务.
- `ImageCaptchaEngine` 这个抽象类实现了`CaptchaEngine`接口, 主要任务是生成图片验证码.
- `CaptchaStore` 这个接口的实现类用于验证码存储, 本文不会使用这个接口而是使用自定义接口.

# JCaptcha如何使用
JCaptcha使用非常简单, 简单地说就是构建一个`ImageCaptchaService`, 然后调用相应方法生成(验证)验证码.  
生成验证码:  
```java
BufferedImage challenge = imageCaptchaService.getImageChallengeForID(id, locale);
```
验证验证码:  
```java
boolean captchaCorrect = imageCaptchaService.validateResponseForID(id, captcha);
```

# 存储扩展
## 分析
JCaptcha默认使用`Map`存储生成的验证码, 并且存储的验证码是一个对象(`com.octo.captcha.image.gimpy.Gimpy`). 这个对象中实际存储验证码字符串的是`response`属性, 但是这个属性是`private`. 外部无法获取这个属性. 也就是说如果想继续使用这个类的话, 那么必须在存储时进行序列化, 取出时反序列化. 当然, 可以用反射机制获取`response`属性, 但是这里没有这么做, 因为我想要实现的逻辑很简单, JCaptcha生成图片验证码, 同时将验证码字符串存入Reids. 验证验证码时, 从Reids取出验证码, 比较, 相同则通过. 所以需要自定义一个验证码类, 这个类只需要一个字段, 就是存储验证码字符串的字段. 当然也可以加入其它字段实现更复杂的逻辑.

<a name="custom_captcha"></a>
## 实现
### 自定义图片验证码类
需要继承`com.octo.captcha.image.ImageCaptcha`类, 因为需要临时存储生成的图片, 并添加下面的代码:
```java
private String word;
public String getWord() {
    return word;
}
public void setWord(String word) {
    this.word = word;
}  
```
如前面所说, 只有一个字段.  


### 实现一个验证码生成工厂  
JCaptcha默认使用`com.octo.captcha.image.gimpy.GimpyFactory`来生成验证码(在`ImageCaptchaEngine`中调用).   
 - `GimpyFactory`的主要组件有:
    - `WordGenerator` 按条件生成验证码字符串
    - `WordToImage` 将验证码字符串写入图片  
 - `GimpyFactory` 生成图片验证码的方法:
```java
 public ImageCaptcha getImageCaptcha(Locale locale){
        Integer wordLength = getRandomLength();                         // 1
        String word = getWordGenerator().getWord(wordLength, locale);   // 2
        BufferedImage image = null;
        try
        {
            image = getWordToImage().getImage(word);                    // 3
        } catch (Throwable e)
        {
            throw new CaptchaException(e);
        }
        ImageCaptcha captcha = new Gimpy(CaptchaQuestionHelper.getQuestion(locale, BUNDLE_QUESTION_KEY), image, word, caseSensitive);               // 4
        return captcha;
 }
```
可以看到这个方法主要有5个步骤:  
1. 根据条件随机验证码字符串长度
2. 根据`1`中的长度生成随机验证码字符串
3. 构建一个包含验证码字符串的图片验证码
4. 构建一个`Gimpy`对象, 用于存储和验证    

只需要修改第4步, 构建一个上面自定义的[图片验证码类](#custom_captcha)对象而不是`Gimpy`对象.  
验证码生成工厂实现如下:
```java
public class WordGimpyFactory extends GimpyFactory {
        public WordGimpyFactory(WordGenerator generator, WordToImage word2image, boolean caseSensitive) {
            super(generator, word2image, caseSensitive);
        }

        @Override
        public ImageCaptcha getImageCaptcha(Locale locale)
        {
            Integer wordLength = getRandomLength();
            String word = getWordGenerator().getWord(wordLength, locale);
            java.awt.image.BufferedImage image = null;
            try {
                image = getWordToImage().getImage(word);
            } catch (Throwable e) {
                throw new CaptchaException(e);
            }
            ImageCaptcha captcha = new WordGimpy(CaptchaQuestionHelper.getQuestion(locale, BUNDLE_QUESTION_KEY), image, word);
            return captcha;
        }
}
```

### 自定义Jedis存储
首先定义一个存储接口:
```java
public interface CaptchaStringStore {

    boolean hasCaptcha(String key);

    void storeCaptchaString(String key, String value, int timeout);

    boolean removeCaptchaString(String key);

    String getCaptchaString(String key);

    int getSize(String keyPattern);

    Collection<?> getFields(String keyPattern);

    void empty(String keyPattern);

    void initAndStart();

    void cleanAndShutdown(String keyPattern);

}
```
实现该接口:
```java
public class JedisCaptchaStore implements CaptchaStringStore {

    @Autowired
    private Jedis jedis;

    public JedisCaptchaStore(Jedis jedis) {
        this.jedis = jedis;
    }

    @Override
    public boolean hasCaptcha(String key) {
        return jedis.exists(key);
    }

    @Override
    public void storeCaptchaString(String key, String value, int timeout) {
        String code = jedis.setex(key, timeout, value);
    }

    @Override
    public long removeCaptchaString(String key) {
        return jedis.del(key);
    }

    @Override
    public String getCaptchaString(String key) {
        return jedis.get(key);
    }

    @Override
    public int getSize(String keyPattern) {
        return jedis.keys(keyPattern).size();
    }

    @Override
    public Collection<?> getFields(String keyPattern) {
        return jedis.keys(keyPattern);
    }

    @Override
    public void empty(String keyPattern) {
        Set<String> keys = jedis.keys(keyPattern);
        String[] keyArr = keys.toArray(new String[keys.size()]);
        jedis.del(keyArr);
    }

    @Override
    public void initAndStart() {

    }

    @Override
    public void cleanAndShutdown(String keyPattern) {
        empty(keyPattern);
    }

}
```
这里`jedis`是直接注入的, Jedis的用法略...


### 注入图片验证码生成工厂到`ImageCaptchaEngine`
因为上面代码实现了一个图片验证码生成工厂, 该工厂是在`ImageCaptchaEngine`中调用的. 所以在构建`ImageCaptchaEngine`时需要把该工厂对象注入.


### 实现`ImageCaptchaService`
主要需要重写的是验证码验证码逻辑, 这里给出关键的代码:
```java
@Override
public Boolean validateResponseForID(String ID, Object obj) throws CaptchaServiceException {
        if (obj == null || !(obj instanceof String))
            return false;
        String response = (String) obj;
        String word = store.getCaptchaString(ID);
        if (StringUtils.isBlank(word) || StringUtils.isBlank((String) response)) {
            return false;
        } else {
            return word.equals(response);
        }
}
```

<br/>
<br/>
<br/>
# 结语
大概地实现已经给出了, 不过还有很多细节没有处理, 比如没用的参数没有去掉等.  
用到再说吧.
